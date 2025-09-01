import { presetAdmin } from '@sa/uno-preset';
import { defineConfig, presetWind4, transformerDirectives, transformerVariantGroup } from 'unocss';
import { themeVars } from './src/theme/vars';

export default defineConfig({
  content: {
    pipeline: {
      exclude: ['node_modules', 'dist']
    }
  },
  presets: [
    presetWind4({
      dark: 'class'
    }),
    presetAdmin()
  ],
  rules: [
    [
      /^h-calc\((.*)\)$/, // 匹配 h-clac(xxx) 的正则表达式
      ([, d]) => ({ height: `calc(${d})px` }) // 生成对应的 CSS 样式
    ]
  ],
  shortcuts: {
    'card-wrapper': 'rd-8px shadow-sm'
  },
  theme: {
    ...themeVars,
    text: {
      icon: {
        fontSize: '1.125rem'
      },
      'icon-xs': {
        fontSize: '0.875rem'
      },
      'icon-small': {
        fontSize: '1rem'
      },
      'icon-large': {
        fontSize: '1.5rem'
      },
      'icon-xl': {
        fontSize: '2rem'
      }
    }
  },
  transformers: [transformerDirectives(), transformerVariantGroup()]
});
