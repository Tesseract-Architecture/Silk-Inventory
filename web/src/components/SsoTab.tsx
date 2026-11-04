// Login con Microsoft (Entra ID): qué cargar en Entra y prueba de las credenciales.
// Sigue la guía de Silk "SSO-Microsoft-Entra.md" (la misma que se usó con Silk Pilot).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Alert, Button, Card, Code, CopyButton, Group, List, Loader, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconPlugConnected } from '@tabler/icons-react';
import { api } from '../api';
import { notifyError } from '../util';

interface SsoInfo {
  redirectUri: string;
  tenantId: string;
  clientId: string;
  hasSecret: boolean;
  allowedDomains: string[];
  devLogin: boolean;
}

function Copy({ value }: { value: string }) {
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? 'Copiado' : 'Copiar'}>
          <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

export default function SsoTab() {
  const { data } = useQuery({ queryKey: ['sso'], queryFn: () => api<SsoInfo>('/api/admin/sso') });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; graphUsers?: boolean } | null>(null);
  if (!data) return <Loader />;

  const test = async () => {
    setTesting(true);
    try {
      setResult(await api('/api/admin/sso/test', { method: 'POST', body: {} }));
    } catch (e) {
      notifyError(e);
    } finally {
      setTesting(false);
    }
  };

  const configured = !!(data.tenantId && data.clientId && data.hasSecret);
  return (
    <Stack maw={780}>
      <Text size="sm" c="dimmed">
        Mismo proceso que Silk Pilot (guía <Code>SSO-Microsoft-Entra.md</Code>): un registro de app en Entra, de un solo inquilino, con
        plataforma <b>Web</b>.
      </Text>

      <Card withBorder>
        <Title order={5} mb="sm">
          Para cargar en Entra
        </Title>
        <Table>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td w={220}>Nombre</Table.Td>
              <Table.Td>
                <Code>Inventario</Code>
              </Table.Td>
              <Table.Td w={40}>
                <Copy value="Inventario" />
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>URI de redirección (Web)</Table.Td>
              <Table.Td>
                <Code>{data.redirectUri}</Code>
              </Table.Td>
              <Table.Td>
                <Copy value={data.redirectUri} />
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
        {data.redirectUri.startsWith('http://') && !data.redirectUri.includes('localhost') && (
          <Alert color="yellow" mt="sm">
            Entra exige <b>https</b> (salvo localhost). Configurá APP_URL con la dirección https del server.
          </Alert>
        )}
        <Text size="xs" c="dimmed" mt="xs">
          La URI tiene que coincidir exactamente (https, dominio y ruta). Sale de <Code>APP_URL</Code> en el .env.
        </Text>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Lo que está configurado en el server (.env)
        </Title>
        <Table>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td w={220}>Id. de directorio (tenant)</Table.Td>
              <Table.Td>{data.tenantId ? <Code>{data.tenantId}</Code> : <Text c="red">falta ENTRA_TENANT_ID</Text>}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Id. de aplicación (cliente)</Table.Td>
              <Table.Td>{data.clientId ? <Code>{data.clientId}</Code> : <Text c="red">falta ENTRA_CLIENT_ID</Text>}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Secreto de cliente</Table.Td>
              <Table.Td>{data.hasSecret ? 'cargado' : <Text c="red">falta ENTRA_CLIENT_SECRET (la columna "Valor")</Text>}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Dominios permitidos</Table.Td>
              <Table.Td>{data.allowedDomains.length ? data.allowedDomains.join(', ') : 'cualquiera del tenant'}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
        {data.devLogin && (
          <Alert color="orange" mt="sm">
            Está activo el login de desarrollo (AUTH_DEV=1): cualquiera puede entrar sin Microsoft. Sacalo en el server.
          </Alert>
        )}
        <Group mt="md">
          <Button leftSection={<IconPlugConnected size={16} />} onClick={test} loading={testing} disabled={!configured}>
            Probar conexión con Microsoft
          </Button>
        </Group>
        {result && (
          <Alert color={result.ok ? 'teal' : 'red'} mt="sm" title={result.ok ? 'Funciona' : 'No funciona'}>
            {result.message}
            {result.ok && (
              <Text size="sm" mt={4}>
                {result.graphUsers
                  ? '"Equipo → Traer de Microsoft" también va a funcionar.'
                  : 'Para "Equipo → Traer de Microsoft" falta el permiso de aplicación User.Read.All con consentimiento de administrador.'}
              </Text>
            )}
          </Alert>
        )}
      </Card>

      <Card withBorder>
        <Title order={5} mb="xs">
          Si algo falla
        </Title>
        <List size="sm" spacing={4}>
          <List.Item>
            <b>AADSTS50011</b> antes de elegir cuenta: la URI de redirección no coincide.
          </List.Item>
          <List.Item>
            <b>AADSTS700016</b>: Client ID o tenant equivocado.
          </List.Item>
          <List.Item>
            Volvés de Microsoft y da error: casi siempre es el secreto (se pegó el <b>Id. de secreto</b> en vez del <b>Valor</b>, o venció).
          </List.Item>
          <List.Item>
            El error real se ve en Entra → Supervisión → Registros de inicio de sesión (tardan 5 a 15 minutos en aparecer).
          </List.Item>
        </List>
      </Card>
    </Stack>
  );
}
