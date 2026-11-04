// Qué versión corre, si hay una más nueva en GitHub, y cómo actualizar.
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Alert, Badge, Button, Card, Code, CopyButton, Group, List, Loader, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconRefresh } from '@tabler/icons-react';
import { api } from '../api';
import { fmtDateTime } from '../util';

export interface VersionInfo {
  repo: string;
  current: { sha: string | null; builtAt: string | null };
  latest: { sha: string; message: string; date: string } | null;
  pending: { sha: string; message: string; date: string }[] | null;
  updateCommand: string;
  error?: string;
}

export const useVersion = (enabled = true) =>
  useQuery({
    queryKey: ['version'],
    queryFn: () => api<VersionInfo>('/api/admin/version'),
    enabled,
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });

const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : '—');
const fmtIso = (iso?: string | null) => (iso ? fmtDateTime(iso.replace('T', ' ').replace('Z', '')) : '');

export default function UpdatesTab() {
  const { data, isFetching, refetch } = useVersion();
  if (!data) return <Loader />;

  const refresh = () => api<VersionInfo>('/api/admin/version?refresh=1').then(() => refetch());
  const upToDate = data.pending?.length === 0;

  return (
    <Stack maw={760}>
      <Group justify="space-between">
        <Group gap="xs">
          {upToDate && <Badge color="teal" size="lg">Al día</Badge>}
          {!!data.pending?.length && (
            <Badge color="orange" size="lg">
              {data.pending.length} {data.pending.length === 1 ? 'cambio pendiente' : 'cambios pendientes'}
            </Badge>
          )}
          {!data.current.sha && <Badge color="gray" size="lg">Versión desconocida</Badge>}
        </Group>
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={refresh} loading={isFetching}>
          Buscar ahora
        </Button>
      </Group>

      {data.error && <Alert color="yellow">{data.error}</Alert>}

      <Card withBorder>
        <Text size="sm">
          <b>Corriendo:</b> <Code>{short(data.current.sha)}</Code>
          {data.current.builtAt && <> · instalada el {fmtIso(data.current.builtAt)}</>}
        </Text>
        {data.latest && (
          <Text size="sm" mt={4}>
            <b>Última en GitHub:</b> <Code>{short(data.latest.sha)}</Code> · {data.latest.message} ({fmtIso(data.latest.date)})
          </Text>
        )}
        {!data.current.sha && (
          <Text size="xs" c="dimmed" mt="xs">
            No se sabe qué versión corre (se instaló sin el script de actualización). Actualizando una vez con el comando de abajo queda
            registrada.
          </Text>
        )}
      </Card>

      {!!data.pending?.length && (
        <Card withBorder>
          <Title order={5} mb="xs">
            Lo que trae la actualización
          </Title>
          <List size="sm" spacing={4}>
            {data.pending.map((c) => (
              <List.Item key={c.sha}>
                <Code>{short(c.sha)}</Code> {c.message} <Text span size="xs" c="dimmed">({fmtIso(c.date)})</Text>
              </List.Item>
            ))}
          </List>
        </Card>
      )}

      <Card withBorder>
        <Title order={5} mb="xs">
          Cómo actualizar
        </Title>
        <Text size="sm" mb="xs">
          Entrá por SSH a la VM (<Code>ssh silkadmin@192.168.12.149</Code>) y corré:
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Code block style={{ flex: 1 }}>
            {data.updateCommand}
          </Code>
          <CopyButton value={data.updateCommand}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copiado' : 'Copiar'}>
                <ActionIcon variant="light" color={copied ? 'teal' : undefined} onClick={copy} size="lg">
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Baja lo nuevo de GitHub, hace un backup de la base, reconstruye y reinicia la app (un par de minutos sin servicio). Los datos y el
          .env no se tocan. Si algo sale mal, en Backups está el de "antes-de-actualizar".
        </Text>
      </Card>
    </Stack>
  );
}
