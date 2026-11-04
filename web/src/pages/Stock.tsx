import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Anchor, Badge, Button, Card, Group, Modal, NumberInput, Progress, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBrandWhatsapp, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import NotifyModal from '../components/NotifyModal';
import { api, canWrite, type ModelStock, useItems, useMe } from '../api';
import { notifyError, notifyOk } from '../util';

function RuleModal({ rule, opened, onClose, onSaved }: { rule: ModelStock | null; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ model: '', min_qty: 10 as number, notes: '' });
  const [lastKey, setLastKey] = useState('');
  const key = `${opened}-${rule?.id}`;
  if (key !== lastKey) {
    setLastKey(key);
    setV({ model: rule?.model ?? '', min_qty: rule?.min_qty ?? 10, notes: rule?.notes ?? '' });
  }
  const save = async () => {
    try {
      if (rule) await api(`/api/model-stock/${rule.id}`, { method: 'PUT', body: v });
      else await api('/api/model-stock', { body: v });
      notifyOk('Guardado');
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={rule ? `Editar ${rule.model}` : 'Nuevo stock mínimo'}>
      <Stack>
        <TextInput
          label="Modelo / part number"
          description="Se cuentan los ítems disponibles cuya descripción o part number sea este modelo"
          placeholder="SFP-10G-SR-S"
          data-autofocus
          value={v.model}
          onChange={(e) => setV({ ...v, model: e.currentTarget.value.toUpperCase() })}
        />
        <NumberInput label="Mínimo" min={0} value={v.min_qty} onChange={(x) => setV({ ...v, min_qty: Number(x) || 0 })} />
        <TextInput label="Notas" value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button onClick={save} disabled={!v.model.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Stock() {
  const { data: me } = useMe();
  const { data: rules = [], refetch } = useQuery({ queryKey: ['model-stock'], queryFn: () => api<ModelStock[]>('/api/model-stock') });
  const { data: items = [] } = useItems();
  const [edit, setEdit] = useState<{ rule: ModelStock | null } | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const write = canWrite(me?.user);
  const consumables = items.filter((i) => i.min_stock != null);

  const remove = (r: ModelStock) =>
    modals.openConfirmModal({
      title: `Quitar stock mínimo de ${r.model}`,
      labels: { confirm: 'Quitar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => api(`/api/model-stock/${r.id}`, { method: 'DELETE' }).then(() => refetch(), notifyError),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Stock mínimo</Title>
        {write && (
          <Group gap="xs">
            <Button variant="default" leftSection={<IconBrandWhatsapp size={16} />} onClick={() => setNotifyOpen(true)}>
              Mandar alerta por WhatsApp
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEdit({ rule: null })}>
              Agregar modelo
            </Button>
          </Group>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        Cuando lo disponible queda por debajo del mínimo aparece en el inicio y en el resumen diario por WhatsApp. Solo cuentan los ítems
        en estado <b>Disponible</b> (no los prestados, reservados o en uso).
      </Text>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={600}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Modelo</Table.Th>
                <Table.Th w={260}>Disponibles / mínimo</Table.Th>
                <Table.Th>Notas</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rules.map((r) => {
                const low = r.available < r.min_qty;
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/inventario?q=${encodeURIComponent(r.model)}`} className="mono">
                        {r.model}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Badge color={low ? 'red' : 'teal'} variant="light" w={80}>
                          {r.available} / {r.min_qty}
                        </Badge>
                        <Progress value={Math.min(100, (r.available / Math.max(1, r.min_qty)) * 100)} color={low ? 'red' : 'teal'} style={{ flex: 1 }} />
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {r.notes}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {write && (
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon variant="subtle" onClick={() => setEdit({ rule: r })}>
                            <IconEdit size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => remove(r)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {rules.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" ta="center" py="md">
                      No hay modelos con stock mínimo
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {consumables.length > 0 && (
        <>
          <Title order={4} mt="md">
            Consumibles con mínimo
          </Title>
          <Card withBorder padding={0}>
            <Table>
              <Table.Tbody>
                {consumables.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/items/${i.id}`}>
                        {i.description}
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        {i.location}
                      </Text>
                    </Table.Td>
                    <Table.Td w={200}>
                      <Badge color={i.quantity <= (i.min_stock ?? 0) ? 'red' : 'teal'} variant="light">
                        {i.quantity} {i.unit ?? ''} / mín. {i.min_stock}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}

      <RuleModal rule={edit?.rule ?? null} opened={!!edit} onClose={() => setEdit(null)} onSaved={() => refetch()} />
      <NotifyModal kind={notifyOpen ? 'stock' : null} onClose={() => setNotifyOpen(false)} />
    </Stack>
  );
}
