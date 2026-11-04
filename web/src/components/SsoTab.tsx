// Login con Microsoft (Entra ID): qué cargar en Entra y prueba de las credenciales.
// Sigue la guía de Silk "SSO-Microsoft-Entra.md" (la misma que se usó con Silk Pilot).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Alert, Button, Card, Code, CopyButton, Group, List, Loader, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconDownload, IconPlugConnected } from '@tabler/icons-react';
import { modals } from '@mantine/modals';
import { api } from '../api';
import { notifyError } from '../util';

interface SsoInfo {
  redirectUri: string;
  tenantId: string;
  clientId: string;
  hasSecret: boolean;
  authMethod: 'secreto' | 'certificado' | null;
  certificate: { thumbprint: string; validFrom: string; validTo: string } | null;
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
  const { data, refetch } = useQuery({ queryKey: ['sso'], queryFn: () => api<SsoInfo>('/api/admin/sso') });
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
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

  const configured = !!(data.tenantId && data.clientId && data.authMethod);

  const generate = (replace: boolean) => {
    const run = async () => {
      setGenerating(true);
      try {
        await api(`/api/admin/sso/certificate${replace ? '?replace=1' : ''}`, { method: 'POST', body: {} });
        setResult(null);
        refetch();
      } catch (e) {
        notifyError(e);
      } finally {
        setGenerating(false);
      }
    };
    if (!replace) return run();
    modals.openConfirmModal({
      title: 'Generar un certificado nuevo',
      children: (
        <Text size="sm">
          El login con Microsoft deja de andar hasta que subas el certificado nuevo a Entra. Hacelo solo para renovarlo antes de que venza.
        </Text>
      ),
      labels: { confirm: 'Generar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: run,
    });
  };
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
              <Table.Td>Credencial</Table.Td>
              <Table.Td>
                {data.authMethod === 'secreto' && 'secreto de cliente (ENTRA_CLIENT_SECRET)'}
                {data.authMethod === 'certificado' && 'certificado (ver abajo)'}
                {!data.authMethod && <Text c="red">falta: generá el certificado de abajo</Text>}
              </Table.Td>
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
          </Alert>
        )}
      </Card>

      {!data.hasSecret && (
        <Card withBorder>
          <Title order={5} mb="xs">
            Certificado (en lugar del secreto)
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            En Silk los secretos de cliente están bloqueados por directiva, así que la app se identifica con un certificado. La clave
            privada queda en el server; a Entra se sube solo el <b>.cer</b> en <b>Certificados y secretos → Certificados → Cargar certificado</b>.
          </Text>
          {data.certificate ? (
            <>
              <Table>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td w={220}>Huella digital</Table.Td>
                    <Table.Td>
                      <Code>{data.certificate.thumbprint}</Code>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Vence</Table.Td>
                    <Table.Td>{data.certificate.validTo.slice(0, 10).split('-').reverse().join('/')}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt={4}>
                En Entra tiene que aparecer un certificado con esta misma huella.
              </Text>
              <Group mt="sm">
                <Button component="a" href="/api/admin/sso/certificate.cer" leftSection={<IconDownload size={16} />}>
                  Descargar .cer para Entra
                </Button>
                <Button variant="subtle" color="red" onClick={() => generate(true)} loading={generating}>
                  Renovar (generar otro)
                </Button>
              </Group>
            </>
          ) : (
            <Button onClick={() => generate(false)} loading={generating}>
              Generar certificado
            </Button>
          )}
        </Card>
      )}

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
            <b>AADSTS700027</b>: Entra no tiene subido el certificado de la app (o es otro): bajá el .cer y subilo de nuevo.
          </List.Item>
          <List.Item>
            El error real se ve en Entra → Supervisión → Registros de inicio de sesión (tardan 5 a 15 minutos en aparecer).
          </List.Item>
        </List>
      </Card>
    </Stack>
  );
}
