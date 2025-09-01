import DarkModeContainer from '@/components/DarkModeContainer';

const GlobalFooter = () => {
  return (
    <DarkModeContainer className="h-full flex-center">
      <a
        href="https://github.com/Mr-Alexx/soybean-admin-react/blob/master/LICENSE"
        rel="noopener noreferrer"
        target="_blank"
      >
        Copyright MIT © 2025 QianQian.
      </a>
      Thanks for&nbsp;
      <a
        className="text-primary"
        href="https://github.com/honghuangdc/soybean-admin"
        rel="noreferrer"
        target="_blank"
      >
        Soybean.
      </a>
    </DarkModeContainer>
  );
};

export default GlobalFooter;
