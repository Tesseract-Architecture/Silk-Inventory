import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Button, Card, Group, Loader, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { api, isAdmin, type Movement, useCategories, useMe } from '../api';
import { ACTION_LABELS, describeDetail, fmtDateTime } from '../util';
import { useRevert } from './ItemDetail';

export default function Activity() {
  const { data: me } = useMe();
  const { data: categories = [] } = useCategories();
  const revert = useRevert();
  const [userId, setUserId] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 300);

  const { data: users = [] } = useQuery({
    queryKey: ['activity', 'users'],
    queryFn: () => api<{ id: number; name: string }[]>('/api/activity/users'),
  });

  const params = new URLSearchParams();
  if (userId) params.set('user_id', userId);
  if (action) params.set('action', action);
  if (range[0]) params.set('from', range[0]);
  if (range[1]) params.set('to', range[1]);
  if (dq) params.set('q', dq);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['activity', params.toString()],
    queryFn: () => api<Movement[]>(`/api/activity?${params}`),
  });
  const catNames = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <Stack>
      <Title order={2}>Actividad</Title>
      <Text size="sm" c="dimmed">
        Todo lo que se hizo en el inventario: quién, qué y cuándo.{' '}
        {isAdmin(me?.user) ? 'Como admin podés deshacer cualquier movimiento.' : ''}
      </Text>
      <Card withBorder padding="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar ítem, serie…"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            style={{ flex: '1 1 220px' }}
          />
          <Select
            placeholder="Persona"
            clearable
            searchable
            data={users.map((u) => ({ value: String(u.id), label: u.name }))}
            value={userId}
            onChange={setUserId}
            w={200}
          />
          <Select
            placeholder="Acción"
            clearable
            data={Object.entries(ACTION_LABELS).map(([value, a]) => ({ value, label: a.label }))}
            value={action}
            onChange={setAction}
            w={180}
          />
          <DatePickerInput type="range" placeholder="Fechas" clearable value={range} onChange={(v) => setRange(v as [string | null, string | null])} w={240} />
        </Group>
      </Card>

      {isLoading ? (
        <Loader />
      ) : (
        <Table.ScrollContainer minWidth={850}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Cuándo</Table.Th>
                <Table.Th w={150}>Quién</Table.Th>
                <Table.Th w={120}>Acción</Table.Th>
                <Table.Th>Ítem</Table.Th>
                <Table.Th>Detalle</Table.Th>
                <Table.Th w={100} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((m) => (
                <Table.Tr key={m.id} style={m.reverted_at ? { opacity: 0.55 } : undefined}>
                  <Table.Td>
                    <Text size="sm">{fmtDateTime(m.created_at)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{m.user ?? 'sistema'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={ACTION_LABELS[m.action]?.color ?? 'gray'}>
                      {ACTION_LABELS[m.action]?.label ?? m.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {m.item_id ? (
                      <Anchor component={Link} to={`/items/${m.item_id}`} size="sm">
                        {m.description}
                      </Anchor>
                    ) : (
                      <Text size="sm">—</Text>
                    )}
                    <Text size="xs" c="dimmed" className="mono">
                      {m.code}
                      {m.serial_number ? ` · ${m.serial_number}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" td={m.reverted_at ? 'line-through' : undefined}>
                      {describeDetail(m.action, m.detail, { categories: catNames })}
                    </Text>
                    {m.reverted_at && (
                      <Text size="xs" c="red">
                        Deshecho por {m.reverted_by_name} el {fmtDateTime(m.reverted_at)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {isAdmin(me?.user) && m.revertible && (
                      <Tooltip label="Volver al estado anterior">
                        <Button size="compact-xs" variant="light" color="red" onClick={() => revert(m)}>
                          Deshacer
                        </Button>
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      Sin movimientos con esos filtros
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
