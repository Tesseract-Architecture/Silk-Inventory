import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon, Alert, Badge, Box, Button, Card, Checkbox, Code, FileInput, Group, Image, List, Loader, NumberInput, Select, SimpleGrid,
  Stack, Switch, Table, Tabs, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconBrandWhatsapp, IconBrandWindows, IconDatabase, IconRefresh, IconDownload, IconEdit, IconFileSpreadsheet, IconPlus, IconSettings, IconTags, IconTrash,
} from '@tabler/icons-react';
import { api, type User, useCategories, useMe, useRefresh } from '../api';
import SsoTab from '../components/SsoTab';
import UpdatesTab from '../components/UpdatesTab';
import { useSearchParams } from 'react-router-dom';
import { fmtDateTime, fmtPhone, notifyError, notifyOk } from '../util';

// ---------------- WhatsApp ----------------

interface WaState { status: string; qr: string | null; me: string | null; lastError: string | null }

function WhatsAppTab() {
  const qc = useQueryClient();
  const { data: wa } = useQuery({
    queryKey: ['wa'],
    queryFn: () => api<WaState>('/api/admin/whatsapp'),
    refetchInterval: (q) => (['esperando_qr', 'conectando'].includes(q.state.data?.status ?? '') ? 2000 : 10000),
  });
  const [to, setTo] = useState('');
  const set = (s: WaState) => qc.setQueryData(['wa'], s);

  const color = wa?.status === 'conectado' ? 'green' : wa?.status === 'esperando_qr' ? 'yellow' : 'gray';
  return (
    <Stack maw={640}>
      <Group>
        <Badge size="lg" color={color} leftSection={<IconBrandWhatsapp size={14} />}>
          {wa?.status ?? '…'}
        </Badge>
        {wa?.me && <Text>Número vinculado: {fmtPhone(wa.me)}</Text>}
      </Group>
      {wa?.lastError && <Alert color="yellow">{wa.lastError}</Alert>}

      {wa?.status === 'desconectado' && (
        <Card withBorder>
          <Stack>
            <Text size="sm">
              Vinculá el WhatsApp de la empresa (como WhatsApp Web): tocá <b>Vincular</b>, después en el celular abrí WhatsApp →{' '}
              <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b> y escaneá el código.
            </Text>
            <Group>
              <Button
                leftSection={<IconBrandWhatsapp size={16} />}
                color="green"
                onClick={() => api<WaState>('/api/admin/whatsapp/connect', { method: 'POST' }).then(set, notifyError)}
              >
                Vincular
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Recomendado: un número dedicado (chip de la empresa), no el personal de alguien.
            </Text>
          </Stack>
        </Card>
      )}
      {wa?.status === 'conectando' && <Loader />}
      {wa?.status === 'esperando_qr' && wa.qr && (
        <Card withBorder w={440} maw="100%" p="sm">
          {/* Fondo blanco propio: en modo oscuro el lector del celular necesita contraste alrededor. */}
          <Image src={wa.qr} alt="QR de WhatsApp" bg="white" radius="sm" style={{ imageRendering: 'pixelated' }} />
          <Text size="sm" ta="center" mt="xs">
            En el celular: WhatsApp → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>, y apuntá a este código.
            Cambia cada unos segundos; si se vence, tocá Vincular de nuevo.
          </Text>
        </Card>
      )}
      {wa?.status === 'conectado' && (
        <>
          <Card withBorder>
            <Stack>
              <Text fw={500}>Mandar un mensaje de prueba</Text>
              <Group align="flex-end">
                <TextInput label="Número" placeholder="11 1234-5678" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
                <Button
                  onClick={() => api('/api/admin/whatsapp/test', { body: { to } }).then(() => notifyOk('Mensaje enviado'), notifyError)}
                  disabled={!to}
                >
                  Enviar prueba
                </Button>
              </Group>
            </Stack>
          </Card>
          <Group>
            <Button
              variant="default"
              color="red"
              onClick={() =>
                modals.openConfirmModal({
                  title: 'Desvincular WhatsApp',
                  children: <Text size="sm">Se dejan de mandar recordatorios hasta que se vuelva a vincular.</Text>,
                  labels: { confirm: 'Desvincular', cancel: 'Cancelar' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => api<WaState>('/api/admin/whatsapp/logout', { method: 'POST' }).then(set, notifyError),
                })
              }
            >
              Desvincular
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}

// ---------------- Avisos ----------------

interface Settings {
  reminder_first_after_days: number;
  reminder_every_days: number;
  reminder_hour: number;
  reminder_weekdays_only: boolean;
  reminder_template: string;
  internal_alert_jid: string;
  individual_enabled: boolean;
  loans_summary_enabled: boolean;
  loans_summary_to: string;
  loans_summary_weekday: number;
  stock_alert_enabled: boolean;
  stock_alert_to: string;
  stock_alert_weekday: number;
}

const WEEKDAY_OPTIONS = [
  { value: '0', label: 'Todos los días' },
  { value: '1', label: 'Los lunes' },
  { value: '2', label: 'Los martes' },
  { value: '3', label: 'Los miércoles' },
  { value: '4', label: 'Los jueves' },
  { value: '5', label: 'Los viernes' },
  { value: '6', label: 'Los sábados' },
  { value: '7', label: 'Los domingos' },
];

/** Número o grupo de WhatsApp. Vacío = usa el destino interno (si `fallback`). */
function Destination({
  label, value, onChange, groups, connected, fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  groups: { id: string; name: string }[];
  connected: boolean;
  fallback?: boolean;
}) {
  const isGroup = value.includes('@g.us');
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <TextInput
        label={label}
        placeholder={fallback ? 'Vacío = el número/grupo interno' : '11 1234-5678'}
        value={isGroup ? '' : value ? (/^\d+$/.test(value) ? fmtPhone(value) : value) : ''}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={isGroup}
      />
      <Select
        label="…o un grupo de WhatsApp"
        placeholder={connected ? 'Elegí un grupo' : 'Conectá WhatsApp para ver los grupos'}
        clearable
        searchable
        data={groups.map((g) => ({ value: g.id, label: g.name }))}
        value={isGroup ? value : null}
        onChange={(v) => onChange(v ?? '')}
      />
    </SimpleGrid>
  );
}

function SettingsTab() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: Settings; defaults: Settings }>('/api/admin/settings') });
  const { data: wa } = useQuery({ queryKey: ['wa'], queryFn: () => api<WaState>('/api/admin/whatsapp') });
  const connected = wa?.status === 'conectado';
  const { data: groups = [] } = useQuery({
    queryKey: ['wa-groups'],
    queryFn: () => api<{ id: string; name: string }[]>('/api/admin/whatsapp/groups'),
    enabled: connected,
  });
  const [s, setS] = useState<Settings | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (!s || !data) return <Loader />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = () =>
    api<{ settings: Settings }>('/api/admin/settings', { method: 'PUT', body: s }).then((r) => {
      setS(r.settings);
      notifyOk('Configuración guardada');
    }, notifyError);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api<{ sent: number; errors: number; skipped: number; loansSummary: boolean | string; stock: boolean | string; notes: string[] }>(
        '/api/admin/run-jobs',
        { method: 'POST' },
      );
      const parts = [`A responsables: ${r.sent} enviados`];
      if (r.errors) parts.push(`${r.errors} con error`);
      if (r.loansSummary === true) parts.push('resumen de préstamos enviado');
      if (r.stock === true) parts.push('alerta de stock enviada');
      notifyOk(parts.join(' · '));
      const problems = [...r.notes, ...[r.loansSummary, r.stock].filter((x): x is string => typeof x === 'string')];
      if (problems.length) notifyError(new Error(problems.join(' · ')));
    } catch (e) {
      notifyError(e);
    } finally {
      setRunning(false);
    }
  };

  const groupList = groups ?? [];
  return (
    <Stack maw={760}>
      <Card withBorder>
        <Title order={5}>Cuándo se mandan</Title>
        <Text size="sm" c="dimmed" mb="sm">
          Todo sale una vez por día a esta hora. Cada aviso se puede prender o apagar por separado.
        </Text>
        <Group align="flex-end">
          <NumberInput label="Hora" min={0} max={23} w={100} value={s.reminder_hour} onChange={(v) => set('reminder_hour', Number(v) || 0)} />
          <Switch
            mb={8}
            label="Solo de lunes a viernes"
            checked={s.reminder_weekdays_only}
            onChange={(e) => set('reminder_weekdays_only', e.currentTarget.checked)}
          />
        </Group>
        <Box mt="sm">
          <Destination
            label="Número interno"
            value={s.internal_alert_jid}
            onChange={(v) => set('internal_alert_jid', v)}
            groups={groupList}
            connected={connected}
          />
          <Text size="xs" c="dimmed" mt={4}>
            Destino por defecto de los resúmenes, y de los préstamos que no tienen responsable (o cuyo responsable no cargó su WhatsApp).
          </Text>
        </Box>
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <div>
            <Title order={5}>1 · A cada responsable, lo suyo</Title>
            <Text size="sm" c="dimmed">
              Cada persona recibe en su WhatsApp los préstamos que tiene a cargo para reclamar, todos juntos en un mensaje.
            </Text>
          </div>
          <Switch checked={s.individual_enabled} onChange={(e) => set('individual_enabled', e.currentTarget.checked)} />
        </Group>
        {s.individual_enabled && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label="Primer aviso a los (días)"
                description="Si el préstamo no tiene fecha de devolución"
                min={1}
                value={s.reminder_first_after_days}
                onChange={(v) => set('reminder_first_after_days', Number(v) || 1)}
              />
              <NumberInput
                label="Repetir cada (días)"
                description="Hasta que se devuelva"
                min={1}
                value={s.reminder_every_days}
                onChange={(v) => set('reminder_every_days', Number(v) || 1)}
              />
            </SimpleGrid>
            <Textarea
              mt="sm"
              label="Mensaje (cuando es un solo préstamo)"
              autosize
              minRows={2}
              value={s.reminder_template}
              onChange={(e) => set('reminder_template', e.currentTarget.value)}
            />
            <Text size="xs" c="dimmed" mt={4}>
              Variables: <Code>{'{nombre}'}</Code> (responsable) <Code>{'{quien}'}</Code> (a quién se le prestó) <Code>{'{item}'}</Code>{' '}
              <Code>{'{serie}'}</Code> <Code>{'{fecha}'}</Code> <Code>{'{dias}'}</Code> <Code>{'{vence}'}</Code>{' '}
              <Button size="compact-xs" variant="subtle" onClick={() => set('reminder_template', data.defaults.reminder_template)}>
                Restaurar mensaje original
              </Button>
            </Text>
          </>
        )}
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <div>
            <Title order={5}>2 · Resumen de todo lo prestado</Title>
            <Text size="sm" c="dimmed">
              Todos los préstamos activos agrupados por responsable: qué, a quién, número de serie y hace cuántos días.
            </Text>
          </div>
          <Switch checked={s.loans_summary_enabled} onChange={(e) => set('loans_summary_enabled', e.currentTarget.checked)} />
        </Group>
        {s.loans_summary_enabled && (
          <Stack gap="sm">
            <Select
              label="Frecuencia"
              w={220}
              allowDeselect={false}
              data={WEEKDAY_OPTIONS}
              value={String(s.loans_summary_weekday)}
              onChange={(v) => set('loans_summary_weekday', Number(v))}
            />
            <Destination
              label="Mandar a"
              value={s.loans_summary_to}
              onChange={(v) => set('loans_summary_to', v)}
              groups={groupList}
              connected={connected}
              fallback
            />
          </Stack>
        )}
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <div>
            <Title order={5}>3 · Alerta de stock mínimo</Title>
            <Text size="sm" c="dimmed">
              Lo que quedó por debajo del mínimo (consumibles y modelos como los SFP). Solo se manda si hay algo bajo el mínimo.
            </Text>
          </div>
          <Switch checked={s.stock_alert_enabled} onChange={(e) => set('stock_alert_enabled', e.currentTarget.checked)} />
        </Group>
        {s.stock_alert_enabled && (
          <Stack gap="sm">
            <Select
              label="Frecuencia"
              w={220}
              allowDeselect={false}
              data={WEEKDAY_OPTIONS}
              value={String(s.stock_alert_weekday)}
              onChange={(v) => set('stock_alert_weekday', Number(v))}
            />
            <Destination
              label="Mandar a"
              value={s.stock_alert_to}
              onChange={(v) => set('stock_alert_to', v)}
              groups={groupList}
              connected={connected}
              fallback
            />
          </Stack>
        )}
      </Card>

      <Group justify="space-between">
        <Button variant="default" onClick={runNow} loading={running}>
          Correr todo ahora
        </Button>
        <Button onClick={save}>Guardar configuración</Button>
      </Group>
    </Stack>
  );
}

// ---------------- Categorías ----------------

function CategoriesTab() {
  const { data: categories = [] } = useCategories();
  const refresh = useRefresh();
  const [name, setName] = useState('');
  const add = () =>
    api('/api/categories', { body: { name } }).then(() => {
      setName('');
      refresh();
    }, notifyError);
  const rename = (id: number, current: string) => {
    let value = current;
    modals.openConfirmModal({
      title: 'Renombrar categoría',
      children: <TextInput defaultValue={current} onChange={(e) => (value = e.currentTarget.value)} data-autofocus />,
      labels: { confirm: 'Guardar', cancel: 'Cancelar' },
      onConfirm: () => api(`/api/categories/${id}`, { method: 'PUT', body: { name: value } }).then(refresh, notifyError),
    });
  };
  return (
    <Stack maw={520}>
      <Group align="flex-end">
        <TextInput label="Nueva categoría" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
        <Button leftSection={<IconPlus size={16} />} onClick={add} disabled={!name.trim()}>
          Agregar
        </Button>
      </Group>
      <Table>
        <Table.Tbody>
          {categories.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>{c.name}</Table.Td>
              <Table.Td w={90}>
                <Text size="sm" c="dimmed">
                  {c.item_count} ítems
                </Text>
              </Table.Td>
              <Table.Td w={80}>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" onClick={() => rename(c.id, c.name)}>
                    <IconEdit size={16} />
                  </ActionIcon>
                  {c.item_count === 0 && (
                    <ActionIcon variant="subtle" color="red" onClick={() => api(`/api/categories/${c.id}`, { method: 'DELETE' }).then(refresh, notifyError)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ---------------- Importar ----------------

interface ImportReport {
  dryRun: boolean;
  sheets: { name: string; headerRow: number | null; columns: Record<string, string>; rows: number; skippedReason?: string }[];
  items: number;
  loans: number;
  contacts: number;
  locations: number;
  warnings: string[];
}

function ImportTab() {
  const refresh = useRefresh();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api<ImportReport>(`/api/admin/import?dry=${dry ? 1 : 0}${replace ? '&replace=1' : ''}`, { form });
      setReport(r);
      if (!dry) {
        notifyOk(`Importados ${r.items} ítems`);
        refresh();
      }
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack maw={760}>
      <Text size="sm" c="dimmed">
        Sube el Excel viejo. Primero se hace una <b>prueba</b> que muestra qué va a importar sin guardar nada. Las hojas de compras e
        históricas (“Compras”, “old”) se saltean. En las notas se detecta “PRESTADO A … fecha”, “la caja no corresponde” y “roto”.
      </Text>
      <FileInput
        label="Archivo .xlsx"
        accept=".xlsx"
        leftSection={<IconFileSpreadsheet size={16} />}
        value={file}
        onChange={(f) => {
          setFile(f);
          setReport(null);
        }}
      />
      <Checkbox
        label="Reemplazar lo importado antes (borra los ítems que vinieron de un Excel y sus préstamos)"
        checked={replace}
        onChange={(e) => setReplace(e.currentTarget.checked)}
      />
      <Group>
        <Button variant="default" onClick={() => run(true)} loading={busy} disabled={!file}>
          1. Probar
        </Button>
        <Button onClick={() => run(false)} loading={busy} disabled={!report?.dryRun}>
          2. Importar de verdad
        </Button>
      </Group>
      {report && (
        <Card withBorder>
          <Title order={5}>{report.dryRun ? 'Resultado de la prueba (no se guardó nada)' : 'Importación terminada'}</Title>
          <Text mt="xs">
            <b>{report.items}</b> ítems · <b>{report.loans}</b> préstamos · <b>{report.contacts}</b> contactos nuevos · <b>{report.locations}</b>{' '}
            ubicaciones nuevas
          </Text>
          <Table mt="sm">
            <Table.Tbody>
              {report.sheets.map((s) => (
                <Table.Tr key={s.name}>
                  <Table.Td fw={500}>{s.name}</Table.Td>
                  <Table.Td>
                    {s.skippedReason ? (
                      <Text size="sm" c="dimmed">
                        Omitida: {s.skippedReason}
                      </Text>
                    ) : (
                      <Text size="sm">
                        {s.rows} filas · columnas: {Object.entries(s.columns).map(([k, v]) => `${v} → ${k}`).join(', ')}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {report.warnings.length > 0 && (
            <Alert color="yellow" mt="sm" title={`${report.warnings.length} advertencias`}>
              <List size="sm" spacing={2}>
                {report.warnings.slice(0, 100).map((w, i) => (
                  <List.Item key={i}>{w}</List.Item>
                ))}
              </List>
            </Alert>
          )}
        </Card>
      )}
    </Stack>
  );
}

// ---------------- Backups ----------------

function BackupsTab() {
  const { data: backups = [], refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api<{ name: string; size: number; created_at: string }[]>('/api/admin/backups'),
  });
  const restore = (name: string) =>
    modals.openConfirmModal({
      title: 'Restaurar backup',
      children: (
        <Text size="sm">
          Toda la base vuelve a como estaba en <b>{name}</b>. Lo que se hizo después se pierde (antes se guarda un backup de seguridad del
          estado actual). La app se reinicia y tarda unos segundos.
        </Text>
      ),
      labels: { confirm: 'Restaurar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api(`/api/admin/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
          notifyOk('Restaurando… la página se recarga en unos segundos');
          setTimeout(() => window.location.reload(), 6000);
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Stack maw={760}>
      <Text size="sm" c="dimmed">
        Se hace un backup automático todos los días a las 3 AM y se guardan los últimos 30. Para deshacer un cambio puntual usá{' '}
        <b>Actividad → Deshacer</b>; esto es para volver <i>todo</i> atrás.
      </Text>
      <Group>
        <Button leftSection={<IconDatabase size={16} />} onClick={() => api('/api/admin/backups', { method: 'POST' }).then(() => refetch(), notifyError)}>
          Hacer backup ahora
        </Button>
      </Group>
      <Table>
        <Table.Tbody>
          {backups.map((b) => (
            <Table.Tr key={b.name}>
              <Table.Td className="mono">{b.name}</Table.Td>
              <Table.Td>{fmtDateTime(b.created_at)}</Table.Td>
              <Table.Td>{(b.size / 1024).toFixed(0)} KB</Table.Td>
              <Table.Td w={200}>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" component="a" href={`/api/admin/backups/${encodeURIComponent(b.name)}`}>
                    <IconDownload size={16} />
                  </ActionIcon>
                  <Button size="compact-xs" variant="light" color="red" onClick={() => restore(b.name)}>
                    Restaurar
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {backups.length === 0 && (
            <Table.Tr>
              <Table.Td>
                <Text c="dimmed">Todavía no hay backups.</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export default function Admin() {
  // ?tab=updates (desde el aviso de versión nueva) abre directo esa pestaña.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'whatsapp';
  return (
    <Stack>
      <Title order={2}>Administración</Title>
      <Tabs value={tab} onChange={(t) => setParams(t ? { tab: t } : {}, { replace: true })} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="whatsapp" leftSection={<IconBrandWhatsapp size={16} />}>
            WhatsApp
          </Tabs.Tab>
          <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>
            Avisos
          </Tabs.Tab>
          <Tabs.Tab value="categories" leftSection={<IconTags size={16} />}>
            Categorías
          </Tabs.Tab>
          <Tabs.Tab value="import" leftSection={<IconFileSpreadsheet size={16} />}>
            Importar Excel
          </Tabs.Tab>
          <Tabs.Tab value="sso" leftSection={<IconBrandWindows size={16} />}>
            Login Microsoft
          </Tabs.Tab>
          <Tabs.Tab value="backups" leftSection={<IconDatabase size={16} />}>
            Backups
          </Tabs.Tab>
          <Tabs.Tab value="updates" leftSection={<IconRefresh size={16} />}>
            Actualizaciones
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="whatsapp" pt="md">
          <WhatsAppTab />
        </Tabs.Panel>
        <Tabs.Panel value="config" pt="md">
          <SettingsTab />
        </Tabs.Panel>
        <Tabs.Panel value="categories" pt="md">
          <CategoriesTab />
        </Tabs.Panel>
        <Tabs.Panel value="import" pt="md">
          <ImportTab />
        </Tabs.Panel>
        <Tabs.Panel value="sso" pt="md">
          <SsoTab />
        </Tabs.Panel>
        <Tabs.Panel value="backups" pt="md">
          <BackupsTab />
        </Tabs.Panel>
        <Tabs.Panel value="updates" pt="md">
          <UpdatesTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
