import { useEffect, useState } from 'react';
import {
  Button, Checkbox, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Textarea, TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { api, ApiError, type Item, useCategories, useLocations, useRefresh, useUsers } from '../api';
import { locationOptions, notifyError, notifyOk, STATUS_OPTIONS } from '../util';

interface Props {
  opened: boolean;
  onClose: () => void;
  item?: Item | null;
  defaultLocationId?: number | null;
  onSaved?: (item: Item) => void;
}

const empty = {
  description: '',
  category_id: null as number | null,
  brand: '',
  part_number: '',
  serial_number: '',
  location_id: null as number | null,
  status: 'disponible' as Item['status'],
  kind: 'unidad' as Item['kind'],
  quantity: 1,
  unit: '',
  min_stock: null as number | null,
  box_mismatch: false,
  notes: '',
  assigned_to: null as number | null,
};

export default function ItemFormModal({ opened, onClose, item, defaultLocationId, onSaved }: Props) {
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = useCategories();
  const { data: users = [] } = useUsers();
  const refresh = useRefresh();
  const [v, setV] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setV(
      item
        ? {
            description: item.description,
            category_id: item.category_id,
            brand: item.brand ?? '',
            part_number: item.part_number ?? '',
            serial_number: item.serial_number ?? '',
            location_id: item.location_id,
            status: item.status,
            kind: item.kind,
            quantity: item.quantity,
            unit: item.unit ?? '',
            min_stock: item.min_stock,
            box_mismatch: !!item.box_mismatch,
            notes: item.notes ?? '',
            assigned_to: item.assigned_to,
          }
        : { ...empty, location_id: defaultLocationId ?? null },
    );
  }, [opened, item, defaultLocationId]);

  const set = <K extends keyof typeof empty>(k: K, val: (typeof empty)[K]) => setV((s) => ({ ...s, [k]: val }));

  const save = async (force = false) => {
    setSaving(true);
    try {
      const body = { ...v, force };
      const saved = item
        ? await api<Item>(`/api/items/${item.id}`, { method: 'PUT', body })
        : await api<Item>('/api/items', { body });
      notifyOk(item ? 'Ítem actualizado' : `Ítem ${saved.code} creado`);
      refresh();
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.duplicate) {
        modals.openConfirmModal({
          title: 'N° de serie repetido',
          children: e.message + '. ¿Guardar igual?',
          labels: { confirm: 'Guardar igual', cancel: 'Cancelar' },
          onConfirm: () => save(true),
        });
      } else notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={item ? `Editar ${item.code}` : 'Nuevo ítem'} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Stack gap="sm">
          <SegmentedControl
            value={v.kind}
            onChange={(k) => set('kind', k as Item['kind'])}
            data={[
              { value: 'unidad', label: 'Equipo / unidad (con serie)' },
              { value: 'consumible', label: 'Consumible / con cantidad' },
            ]}
          />
          <TextInput
            label="Descripción / Modelo"
            required
            data-autofocus
            value={v.description}
            onChange={(e) => set('description', e.currentTarget.value)}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Categoría"
              searchable
              clearable
              data={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              value={v.category_id ? String(v.category_id) : null}
              onChange={(x) => set('category_id', x ? Number(x) : null)}
            />
            <Select
              label="Ubicación"
              searchable
              clearable
              data={locationOptions(locations)}
              value={v.location_id ? String(v.location_id) : null}
              onChange={(x) => set('location_id', x ? Number(x) : null)}
            />
            <TextInput label="Marca" value={v.brand} onChange={(e) => set('brand', e.currentTarget.value)} />
            <TextInput label="Part number" value={v.part_number} onChange={(e) => set('part_number', e.currentTarget.value)} />
            <TextInput
              label="N° de serie"
              value={v.serial_number}
              onChange={(e) => set('serial_number', e.currentTarget.value.toUpperCase())}
              classNames={{ input: 'mono' }}
            />
            <Select
              label="Estado"
              data={STATUS_OPTIONS}
              value={v.status}
              onChange={(x) => x && set('status', x as Item['status'])}
              allowDeselect={false}
            />
          </SimpleGrid>
          {v.status === 'en_uso' && (
            <Select
              label="¿Quién lo tiene?"
              description="Alguien de Silk que lo está usando (se lo llevó a un trabajo, está en su oficina…). No es un préstamo."
              placeholder="Nadie en particular (ej. instalado en el rack)"
              searchable
              clearable
              data={users.map((u) => ({ value: String(u.id), label: u.name }))}
              value={v.assigned_to ? String(v.assigned_to) : null}
              onChange={(x) => set('assigned_to', x ? Number(x) : null)}
            />
          )}
          {v.kind === 'consumible' && (
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Cantidad" min={0} value={v.quantity} onChange={(x) => set('quantity', Number(x) || 0)} />
              <TextInput label="Unidad" placeholder="u., m, rollos…" value={v.unit} onChange={(e) => set('unit', e.currentTarget.value)} />
              <NumberInput
                label="Stock mínimo"
                description="Avisa cuando baja de esto"
                min={0}
                value={v.min_stock ?? ''}
                onChange={(x) => set('min_stock', x === '' ? null : Number(x))}
              />
            </SimpleGrid>
          )}
          <Checkbox
            label="La caja no corresponde al equipo"
            checked={v.box_mismatch}
            onChange={(e) => set('box_mismatch', e.currentTarget.checked)}
          />
          <Textarea label="Notas" autosize minRows={2} value={v.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
