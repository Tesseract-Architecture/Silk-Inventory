import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Card, Group, Loader, Progress, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconBox, IconBoxOff, IconBrandWhatsapp, IconClockExclamation, IconHandGrab, IconTool } from '@tabler/icons-react';
import { api, type Movement } from '../api';
import { ACTION_LABELS, describeDetail, fmtDate, fmtDateTime, fmtLoanDate } from '../util';

interface DashboardData {
  totals: { items: number; loaned: number; overdue: number; lowStock: number; broken: number; boxMismatch: number };
  byLocation: { name: string; n: number }[];
  byCategory: { name: string; n: number }[];
  loans: { id: number; item_id: number; item_description: string; serial_number: string | null; contact_name: string; contact_company: string | null; loaned_at: string; date_unknown: number; days: number; overdue: boolean }[];
  lowStock: { kind: 'item' | 'modelo'; id: number; code: string | null; description: string; quantity: number; min_stock: number; unit: string | null }[];
  recent: Movement[];
  whatsapp: string;
}

function Stat({ label, value, icon: Icon, color, to }: { label: string; value: number; icon: typeof IconBox; color: string; to: string }) {
  return (
    <Card withBorder component={Link} to={to} padding="md">
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text fw={700} fz={28}>
            {value}
          </Text>
        </div>
        <Icon size={32} color={`var(--mantine-color-${color}-6)`} stroke={1.5} />
      </Group>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  if (isLoading || !data) return <Loader />;
  const t = data.totals;
  const maxLoc = Math.max(1, ...data.byLocation.map((l) => l.n));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Inicio</Title>
        <Badge
          size="lg"
          variant="light"
          color={data.whatsapp === 'conectado' ? 'green' : 'gray'}
          leftSection={<IconBrandWhatsapp size={14} />}
        >
          WhatsApp: {data.whatsapp}
        </Badge>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Stat label="Ítems" value={t.items} icon={IconBox} color="indigo" to="/inventario" />
        <Stat label="Prestados" value={t.loaned} icon={IconHandGrab} color="orange" to="/prestamos" />
        <Stat label="Para reclamar" value={t.overdue} icon={IconClockExclamation} color="red" to="/prestamos" />
        <Stat label="Bajo stock" value={t.lowStock} icon={IconAlertTriangle} color="yellow" to="/stock" />
        <Stat label="Rotos / reparación" value={t.broken} icon={IconTool} color="grape" to="/inventario?status=roto" />
        <Stat label="Caja no corresponde" value={t.boxMismatch} icon={IconBoxOff} color="gray" to="/inventario?box=1" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={4} mb="sm">
            Préstamos activos
          </Title>
          {data.loans.length === 0 ? (
            <Text c="dimmed">No hay nada prestado.</Text>
          ) : (
            <Table>
              <Table.Tbody>
                {data.loans.slice(0, 10).map((l) => (
                  <Table.Tr key={l.id} className="clickable-row" onClick={() => navigate(`/items/${l.item_id}`)}>
                    <Table.Td>
                      <Text size="sm">{l.item_description}</Text>
                      {l.serial_number && (
                        <Text size="xs" c="dimmed" className="mono">
                          {l.serial_number}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{l.contact_name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={l.overdue ? 'red' : 'gray'} variant="light">
                        {l.days} días
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {fmtLoanDate(l.loaned_at, l.date_unknown)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {data.loans.length > 10 && (
            <Anchor component={Link} to="/prestamos" size="sm" mt="xs">
              Ver los {data.loans.length}
            </Anchor>
          )}
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Por ubicación
          </Title>
          <Stack gap={8}>
            {data.byLocation.map((l) => (
              <div key={l.name}>
                <Group justify="space-between">
                  <Text size="sm">{l.name}</Text>
                  <Text size="sm" fw={600}>
                    {l.n}
                  </Text>
                </Group>
                <Progress value={(l.n / maxLoc) * 100} size="sm" />
              </div>
            ))}
            {data.byLocation.length === 0 && <Text c="dimmed">Todavía no hay ítems cargados.</Text>}
          </Stack>
        </Card>

        {data.lowStock.length > 0 && (
          <Card withBorder>
            <Title order={4} mb="sm">
              Bajo stock mínimo
            </Title>
            <Table>
              <Table.Tbody>
                {data.lowStock.map((i) => (
                  <Table.Tr
                    key={`${i.kind}-${i.id}`}
                    className="clickable-row"
                    onClick={() => navigate(i.kind === 'item' ? `/items/${i.id}` : '/stock')}
                  >
                    <Table.Td>{i.description}</Table.Td>
                    <Table.Td>
                      <Badge color="red" variant="light">
                        {i.quantity} {i.unit ?? ''} / mín. {i.min_stock}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>Últimos movimientos</Title>
            <Anchor component={Link} to="/actividad" size="sm">
              Ver todo
            </Anchor>
          </Group>
          <Stack gap={6}>
            {data.recent.map((m) => (
              <Group key={m.id} gap="xs" wrap="nowrap" align="flex-start">
                <Badge size="xs" variant="light" color={ACTION_LABELS[m.action]?.color ?? 'gray'} w={95} style={{ flex: 'none' }}>
                  {ACTION_LABELS[m.action]?.label ?? m.action}
                </Badge>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" lineClamp={1}>
                    {m.item_id ? (
                      <Anchor component={Link} to={`/items/${m.item_id}`} inherit>
                        {m.description}
                      </Anchor>
                    ) : (
                      m.description
                    )}{' '}
                    <Text span c="dimmed" size="xs">
                      {describeDetail(m.action, m.detail)}
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    {m.user ?? 'sistema'} · {fmtDateTime(m.created_at)}
                  </Text>
                </div>
              </Group>
            ))}
            {data.recent.length === 0 && <Text c="dimmed">Sin movimientos todavía.</Text>}
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
