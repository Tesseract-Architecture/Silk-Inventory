import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Anchor, Autocomplete, Badge, Button, Card, Group, Modal, NumberInput, Progress, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBrandWhatsapp, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import NotifyModal from '../components/NotifyModal';
import { api, canWrite, type Item, type ModelStock, useItems, useMe } from '../api';
import { notifyError, notifyOk } from '../util';

// Igual que en el servidor: sin espacios, sin "=" y en mayúsculas.
const normModel = (s: string) => s.trim().toUpperCase().replace(/=/g, '').replace(/\s+/g, '');

interface ModelOption {
  value: string;
  available: number;
  total: number;
}

/** Modelos que ya hay en el inventario (por descripción y por part number), con cuántos hay disponibles. */
function modelOptions(items: Item[], skip: Set<string>): ModelOption[] {
  const byKey = new Map<string, ModelOption>();
  for (const i of items) {
    const qty = i.kind === 'consumible' ? i.quantity : 1;
    const names = [i.description, i.part_number].filter((x): x is string => !!x?.trim());
    for (const key of new Set(names.map(normModel))) {
      if (skip.has(key)) continue;
      const o = byKey.get(key) ?? { value: names.find((n) => normModel(n) === key)!.trim().toUpperCase(), available: 0, total: 0 };
      o.total += qty;
      if (i.status === 'disponible') o.available += qty;
      byKey.set(key, o);
    }
  }
  return [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value));
}

function RuleModal({
  rule, opened, onClose, onSaved, items, rules,
}: {
  rule: ModelStock | null;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  items: Item[];
  rules: ModelStock[];
}) {
  const [v, setV] = useState({ model: '', min_qty: 10 as number, notes: '' });
  const [lastKey, setLastKey] = useState('');
  const key = `${opened}-${rule?.id}`;
  if (key !== lastKey) {
    setLastKey(key);
    setV({ model: rule?.model ?? '', min_qty: rule?.min_qty ?? 10, notes: rule?.notes ?? '' });
  }
  // Los que ya tienen mínimo no se sugieren (salvo el que se está editando).
  const options = useMemo(
    () => modelOptions(items, new Set(rules.filter((r) => r.id !== rule?.id).map((r) => r.model))),
    [items, rules, rule?.id],
  );
  const byValue = new Map(options.map((o) => [o.value, o]));
  const picked = options.find((o) => normModel(o.value) === normModel(v.model));

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
        <Autocomplete
          label="Modelo / part number"
          description="Elegí uno del inventario o escribí uno nuevo. Se cuentan los ítems disponibles con esa descripción o part number."
          placeholder="Buscá: SFP-10G, GLC, room bar…"
          data-autofocus
          data={options.map((o) => o.value)}
          limit={40}
          maxDropdownHeight={320}
          renderOption={({ option }) => {
            const o = byValue.get(option.value);
            return (
              <Group justify="space-between" wrap="nowrap" w="100%" gap="sm">
                <Text size="sm" className="mono">
                  {option.value}
                </Text>
                {o && (
                  <Text size="xs" c={o.available ? 'teal' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                    {o.available} disp. de {o.total}
                  </Text>
                )}
              </Group>
            );
          }}
          value={v.model}
          onChange={(x) => setV({ ...v, model: x.toUpperCase() })}
        />
        {v.model.trim() && (
          <Text size="xs" c="dimmed" mt={-8}>
            {picked
              ? `Hoy hay ${picked.available} disponibles (${picked.total} en total con los prestados, reservados o en uso).`
              : 'No hay nada cargado con ese modelo todavía: va a contar desde 0.'}
          </Text>
        )}
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

      <RuleModal
        items={items}
        rules={rules}
        rule={edit?.rule ?? null}
        opened={!!edit}
        onClose={() => setEdit(null)}
        onSaved={() => refetch()}
      />
      <NotifyModal kind={notifyOpen ? 'stock' : null} onClose={() => setNotifyOpen(false)} />
    </Stack>
  );
}
