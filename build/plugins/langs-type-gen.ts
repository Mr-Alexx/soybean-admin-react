import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Plugin } from 'vite';

// 指定默认监听的语言文件目录，重要！
// 以后添加语言的时候优先添加到该语言目录下，会自动生成类型定义文件
const defaultWatchLang = 'zh-cn';

// 修复 traverse 导入问题 - 处理 ES 模块和 CommonJS 兼容性
const traverseDefault = (traverse as any).default || traverse;

interface LangsTypeGenOptions {
  /** 语言配置文件目录 */
  langsDir?: string;
  /** 输出类型文件路径 */
  outputPath?: string;
  /** 监听的语言目录 */
  watchDirs?: string[];
}

/**
 * 从TypeScript文件中提取类型信息
 */
function extractTypeFromFile(filePath: string): Record<string, any> {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // 解析TypeScript代码
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript']
    });

    let exportedObject: Record<string, any> = {};
    const localVariables: Record<string, Record<string, any>> = {};
    let exportedVarName = '';

    traverseDefault(ast, {
      // 处理 const xxx = { ... }; 模式，包括带类型注解的声明
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (t.isIdentifier(path.node.id) && path.node.init) {
          const objName = path.node.id.name;
          if (t.isObjectExpression(path.node.init)) {
            const structure = extractObjectStructure(path.node.init);
            localVariables[objName] = structure;
          }
        }
      },

      // 处理直接 export default { ... } 模式
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        if (t.isObjectExpression(path.node.declaration)) {
          exportedObject = extractObjectStructure(path.node.declaration);
        } else if (t.isIdentifier(path.node.declaration)) {
          // export default xxx; 模式
          exportedVarName = path.node.declaration.name;
        }
      }
    });

    // 如果是通过变量导出，使用变量的结构
    if (exportedVarName && localVariables[exportedVarName]) {
      exportedObject = localVariables[exportedVarName];
    }

    return exportedObject;
  } catch (error) {
    console.warn(`Failed to parse ${filePath}:`, error);
    return {};
  }
}

/**
 * 从对象表达式中提取结构
 */
function extractObjectStructure(objExpr: t.ObjectExpression): Record<string, any> {
  const result: Record<string, any> = {};

  objExpr.properties.forEach(prop => {
    if (t.isObjectProperty(prop)) {
      let key = '';

      // 处理不同类型的键
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      } else {
        return; // 跳过不支持的键类型
      }

      if (t.isStringLiteral(prop.value)) {
        result[key] = 'string';
      } else if (t.isNumericLiteral(prop.value)) {
        result[key] = 'number';
      } else if (t.isBooleanLiteral(prop.value)) {
        result[key] = 'boolean';
      } else if (t.isObjectExpression(prop.value)) {
        result[key] = extractObjectStructure(prop.value);
      } else if (t.isIdentifier(prop.value)) {
        // 处理引用其他变量的情况，标记为对象类型
        result[key] = { '...imported': 'any' };
      } else if (t.isTemplateLiteral(prop.value)) {
        result[key] = 'string';
      } else {
        result[key] = 'any';
      }
    } else if (t.isSpreadElement(prop)) {
      // 处理展开语法 ...other
      if (t.isIdentifier(prop.argument)) {
        result[`...${prop.argument.name}`] = { '...spread': 'any' };
      }
    }
  });

  return result;
}

/**
 * 将类型结构转换为TypeScript类型定义字符串
 */
function generateTypeDefinition(structure: Record<string, any>, indent = 0): string {
  const spaces = '  '.repeat(indent);
  const lines: string[] = [];

  Object.entries(structure).forEach(([key, value]) => {
    // 跳过展开语法标记
    if (key === '...spread') {
      return;
    }

    // 处理特殊字符的键名
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;

    if (typeof value === 'object' && value !== null) {
      lines.push(`${spaces}${safeKey}: {`);
      lines.push(generateTypeDefinition(value, indent + 1));
      lines.push(`${spaces}};`);
    } else {
      lines.push(`${spaces}${safeKey}: ${value};`);
    }
  });

  return lines.join('\n');
}

/**
 * 生成完整的类型定义文件内容
 */
function generateLangsTypeFile(langObject: Record<string, any>): string {
  const langTypes = generateTypeDefinition(langObject, 1);

  return `/**
 * 语言配置类型定义
 * 此文件由 Vite 插件自动生成，请勿手动修改
 */
type Langs = {
${langTypes}
}

export default Langs;
`;
}

/**
 * 只读取语言目录下的 index.ts 文件并提取类型信息
 */
function scanLanguageDirectory(langDir: string): Record<string, any> {
  const indexPath = join(langDir, 'index.ts');

  if (!existsSync(indexPath)) {
    return {};
  }

  return extractDirectStructureFromIndex(indexPath);
}

/**
 * 从index.ts文件中提取export default的结构
 */
function extractDirectStructureFromIndex(filePath: string): Record<string, any> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript']
    });

    const exportedStructure: Record<string, any> = {};
    const importedModules: Set<string> = new Set();

    // 收集所有import的模块名
    traverseDefault(ast, {
      ImportDefaultSpecifier(path: NodePath<t.ImportDefaultSpecifier>) {
        if (t.isIdentifier(path.node.local)) {
          importedModules.add(path.node.local.name);
        }
      }
    });

    // 解析export default结构
    traverseDefault(ast, {
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        if (t.isObjectExpression(path.node.declaration)) {
          // 处理export default { ... }形式
          path.node.declaration.properties.forEach(prop => {
            if (t.isObjectProperty(prop)) {
              let key = '';
              if (t.isIdentifier(prop.key)) {
                key = prop.key.name;
              } else if (t.isStringLiteral(prop.key)) {
                key = prop.key.value;
              }

              if (key) {
                if (t.isIdentifier(prop.value) && importedModules.has(prop.value.name)) {
                  // 这是一个导入的模块，需要读取对应文件
                  const moduleFilePath = join(dirname(filePath), `${prop.value.name}.ts`);
                  if (existsSync(moduleFilePath)) {
                    exportedStructure[key] = extractTypeFromFile(moduleFilePath);
                  } else {
                    exportedStructure[key] = {};
                  }
                } else if (t.isObjectExpression(prop.value)) {
                  // 直接定义的对象
                  exportedStructure[key] = extractObjectStructure(prop.value);
                } else if (t.isStringLiteral(prop.value)) {
                  exportedStructure[key] = 'string';
                } else if (t.isNumericLiteral(prop.value)) {
                  exportedStructure[key] = 'number';
                } else if (t.isBooleanLiteral(prop.value)) {
                  exportedStructure[key] = 'boolean';
                }
              }
            }
          });
        }
      }
    });

    return exportedStructure;
  } catch (error) {
    console.warn(`Failed to parse index file ${filePath}:`, error);
    return {};
  }
}

/**
 * 扫描语言配置目录并生成类型
 */
function generateLangsTypes(langsDir: string, outputPath: string) {
  const startTime = Date.now();
  console.log('🔄 正在生成语言类型文件...');

  const langDir = join(langsDir, defaultWatchLang);

  if (!existsSync(langDir)) {
    console.error('❌ 语言目录不存在:', langDir);
    return;
  }

  const langObject = scanLanguageDirectory(langDir);

  // 生成类型定义内容
  const typeContent = generateLangsTypeFile(langObject);

  // 确保输出目录存在
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 直接覆盖文件内容
  writeFileSync(outputPath, typeContent, 'utf-8');

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(`✅ 语言类型文件生成完成! 耗时: ${duration}ms`);
}

/**
 * 语言类型生成插件
 */
export function setupLangsTypeGen(options: LangsTypeGenOptions = {}): Plugin {
  const { langsDir = 'src/locales/langs', outputPath = 'src/types/langs.d.ts' } = options;

  let root = '';

  return {
    name: 'langs-type-gen',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      // 初始生成类型文件
      const fullLangsDir = join(root, langsDir);
      const fullOutputPath = join(root, outputPath);
      generateLangsTypes(fullLangsDir, fullOutputPath);
    },
    configureServer(server) {
      // 使用Vite内置的文件监听机制
      const watchPaths = join(root, langsDir, defaultWatchLang, '**/*.ts');
      console.log('watchPaths', watchPaths);

      const regenerateTypes = (filePath: string) => {
        console.log('🔄 文件变化触发类型重新生成:', filePath);
        const fullLangsDir = join(root, langsDir);
        const fullOutputPath = join(root, outputPath);
        generateLangsTypes(fullLangsDir, fullOutputPath);

        // 通知客户端重新加载
        server.ws.send({
          type: 'full-reload'
        });
      };

      // 使用Vite的文件监听机制
      server.middlewares.use((req, res, next) => {
        next();
      });

      // 监听文件系统变化
      const watcher = server.watcher;

      watcher.on('change', filePath => {
        // 检查是否是语言文件
        if (filePath.includes(`${langsDir}/${defaultWatchLang}`) && filePath.endsWith('.ts')) {
          console.log('📁 Vite检测到语言文件变化:', filePath);
          regenerateTypes(filePath);
        }
      });

      watcher.on('add', filePath => {
        if (filePath.includes(`${langsDir}/${defaultWatchLang}`) && filePath.endsWith('.ts')) {
          console.log('📁 Vite检测到语言文件新增:', filePath);
          regenerateTypes(filePath);
        }
      });

      watcher.on('unlink', filePath => {
        if (filePath.includes(`${langsDir}/${defaultWatchLang}`) && filePath.endsWith('.ts')) {
          console.log('📁 Vite检测到语言文件删除:', filePath);
          regenerateTypes(filePath);
        }
      });

      // 添加手动触发端点用于测试
      server.middlewares.use('/__regenerate-types', (req, res) => {
        const fullLangsDir = join(root, langsDir);
        const fullOutputPath = join(root, outputPath);
        generateLangsTypes(fullLangsDir, fullOutputPath);
        res.end('Types regenerated');
      });

      // 服务器关闭时清理监听器
      server.httpServer?.on('close', () => {
        watcher.close();
      });
    }
  };
}
