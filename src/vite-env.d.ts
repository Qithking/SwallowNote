/// <reference types="vite/client" />

interface Window {
  React: typeof import('react')
  ReactDOM: typeof import('react-dom')
  ReactJSXRuntime: typeof import('react/jsx-runtime')
  SonnerToast: typeof import('sonner')['toast']
  ReactI18Next: {
    useTranslation: typeof import('react-i18next')['useTranslation']
  }
}
