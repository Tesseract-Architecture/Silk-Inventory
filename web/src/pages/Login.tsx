import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Center, Divider, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import SilkLogo from '../components/SilkLogo';
import { IconBrandWindows } from '@tabler/icons-react';
import { api, useMe } from '../api';
import { notifyError } from '../util';

export default function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const me = useMe();
  const [email, setEmail] = useState('');

  const devLogin = async () => {
    try {
      await api('/api/auth/dev-login', { body: { email } });
      window.location.href = '/';
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-default-hover)">
      <Paper withBorder shadow="sm" p="xl" w={380} maw="100%">
        <Stack>
          <Center>
            <SilkLogo height={64} />
          </Center>
          <div>
            <Title order={2} ta="center">
              Inventario
            </Title>
            <Text c="dimmed" ta="center" size="sm">
              Ingresá con tu cuenta de la empresa
            </Text>
          </div>
          {error && <Alert color="red">{error}</Alert>}
          {me.data?.user && (
            <Button component="a" href="/" variant="light">
              Ya estás logueado como {me.data.user.name} — entrar
            </Button>
          )}
          <Button
            component="a"
            href="/auth/login"
            size="md"
            leftSection={<IconBrandWindows size={20} />}
            disabled={!me.data?.entraConfigured}
          >
            Ingresar con Microsoft
          </Button>
          {me.data && !me.data.entraConfigured && (
            <Text size="xs" c="dimmed" ta="center">
              El login de Microsoft todavía no está configurado (ver README).
            </Text>
          )}
          {me.data?.devLogin && (
            <>
              <Divider label="Modo desarrollo" />
              <TextInput
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && devLogin()}
              />
              <Button variant="default" onClick={devLogin}>
                Entrar sin Microsoft
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
