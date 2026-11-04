import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTheme, MantineProvider, type MantineColorsTuple } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import 'dayjs/locale/es';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import App from './App';

// Paleta de Silk Technologies: el verde agua de la "S" (#54BBB0) y el gris del logo.
const silk: MantineColorsTuple = [
  '#e9f8f6',
  '#d8efeb',
  '#b0ddd6',
  '#84cbc0',
  '#61bdb0',
  '#4bb4a6',
  '#3eb0a1',
  '#2f9a8c',
  '#228a7c',
  '#06786b',
];

const theme = createTheme({
  colors: { silk },
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  components: {
    Table: { defaultProps: { verticalSpacing: 6, highlightOnHover: true } },
    DateInput: { defaultProps: { valueFormat: 'DD/MM/YYYY' } },
    DatePickerInput: { defaultProps: { valueFormat: 'DD/MM/YYYY' } },
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 10_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <DatesProvider settings={{ locale: 'es', firstDayOfWeek: 1 }}>
          <ModalsProvider labels={{ confirm: 'Confirmar', cancel: 'Cancelar' }}>
            <Notifications position="top-right" />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ModalsProvider>
        </DatesProvider>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
