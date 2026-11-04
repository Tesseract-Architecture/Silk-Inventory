import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Checkbox, Group, Loader, Menu, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowsMove, IconDownload, IconHandGrab, IconPlus, IconQrcode, IconSearch } from '@tabler/icons-react';
import { api, canWrite, useCategories, useItems, useLocations, useMe, useRefresh } from '../api';
import ItemsTable from '../components/ItemsTable';
import ItemFormModal from '../components/ItemFormModal';
import LoanFormModal from '../components/LoanFormModal';
import { descendantIds, locationOptions, norm, notifyError, notifyOk, STATUS_OPTIONS } from '../util';

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [showBajas, setShowBajas] = useState(params.get('status') === 'baja');
  const { data: items = [], isLoading } = useItems(showBajas);
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = useCategories();
  const refresh = useRefresh();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [dq] = useDebouncedValue(q, 150);
  const location = params.get('location');
  const category = params.get('category');
  const status = params.get('status');
  const lowStock = params.get('lowstock') === '1';
  const box = params.get('box') === '1';

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  // Si viene ?q= desde el buscador del header, actualizar el campo.
  const urlQ = params.get('q') ?? '';
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  const filtered = useMemo(() => {
    const locIds = location ? descendantIds(locations, Number(location)) : null;
    const terms = norm(dq).split(/\s+/).filter(Boolean);
    return items.filter((i) => {
      if (locIds && !(i.location_id && locIds.has(i.location_id))) return false;
      if (category && String(i.category_id) !== category) return false;
      if (status && i.status !== status) return false;
      if (lowStock && !(i.min_stock != null && i.quantity <= i.min_stock)) return false;
      if (box && !i.box_mismatch) return false;
      if (terms.length) {
        const hay = norm(
          [i.code, i.description, i.serial_number, i.brand, i.part_number, i.notes, i.category, i.location, i.loan_contact, i.loan_company].join(' '),
        );
        return terms.every((t) => hay.includes(t));
      }
      return true;
    });
  }, [items, locations, dq, location, category, status, lowStock, box]);

  const bulkMove = async () => {
    try {
      await api('/api/items/bulk-move', { body: { ids: [...selected], location_id: Number(moveTo) } });
      notifyOk(`${selected.size} ítems movidos`);
      setMoveOpen(false);
      setSelected(new Set());
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  const write = canWrite(me?.user);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Inventario</Title>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} component="a" href="/api/export.xlsx">
            Exportar Excel
          </Button>
          {write && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setNewOpen(true)}>
              Nuevo ítem
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder padding="sm">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            placeholder="Buscar (descripción, serie, código, notas…)"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            style={{ flex: '1 1 260px' }}
          />
          <Select
            placeholder="Ubicación"
            searchable
            clearable
            data={locationOptions(locations)}
            value={location}
            onChange={(v) => setParam('location', v)}
            w={220}
          />
          <Select
            placeholder="Categoría"
            searchable
            clearable
            data={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            value={category}
            onChange={(v) => setParam('category', v)}
            w={200}
          />
          <Select placeholder="Estado" clearable data={STATUS_OPTIONS} value={status} onChange={(v) => setParam('status', v)} w={160} />
          <Checkbox label="Bajo stock" checked={lowStock} onChange={(e) => setParam('lowstock', e.currentTarget.checked ? '1' : null)} />
          <Checkbox label="Caja no corresponde" checked={box} onChange={(e) => setParam('box', e.currentTarget.checked ? '1' : null)} />
          <Checkbox label="Mostrar bajas" checked={showBajas} onChange={(e) => setShowBajas(e.currentTarget.checked)} />
        </Group>
      </Card>

      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {filtered.length} de {items.length} ítems
          {selected.size > 0 && ` · ${selected.size} seleccionados`}
        </Text>
        {selected.size > 0 && (
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setSelected(new Set())}>
              Limpiar selección
            </Button>
            <Menu>
              <Menu.Target>
                <Button size="xs">Acciones ({selected.size})</Button>
              </Menu.Target>
              <Menu.Dropdown>
                {write && (
                  <Menu.Item leftSection={<IconHandGrab size={16} />} onClick={() => setLoanOpen(true)}>
                    Prestar
                  </Menu.Item>
                )}
                {write && (
                  <Menu.Item leftSection={<IconArrowsMove size={16} />} onClick={() => setMoveOpen(true)}>
                    Mover a…
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<IconQrcode size={16} />} onClick={() => navigate(`/etiquetas?ids=${[...selected].join(',')}`)}>
                  Imprimir etiquetas QR
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}
      </Group>

      {isLoading ? <Loader /> : <ItemsTable items={filtered} selected={selected} onSelectedChange={setSelected} />}

      <ItemFormModal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        defaultLocationId={location ? Number(location) : null}
        onSaved={(i) => navigate(`/items/${i.id}`)}
      />
      <LoanFormModal opened={loanOpen} onClose={() => { setLoanOpen(false); setSelected(new Set()); }} itemIds={[...selected]} />
      <Modal opened={moveOpen} onClose={() => setMoveOpen(false)} title={`Mover ${selected.size} ítems`}>
        <Stack>
          <Select label="Nueva ubicación" searchable data={locationOptions(locations)} value={moveTo} onChange={setMoveTo} />
          <Group justify="flex-end">
            <Button onClick={bulkMove} disabled={!moveTo}>
              Mover
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
