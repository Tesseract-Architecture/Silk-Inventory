import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon, Badge, Box, Breadcrumbs, Anchor, Button, Card, Flex, Group, Menu, Modal, ScrollArea, Select, Stack, Text, TextInput,
  Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconBuildingWarehouse, IconChevronDown, IconChevronRight, IconDots, IconFoldDown, IconFoldUp, IconEdit, IconFlask, IconFolder, IconLayoutRows,
  IconPlus, IconPrinter, IconQrcode, IconSearch, IconServer2, IconTrash, IconArchive,
} from '@tabler/icons-react';
import { api, canWrite, isAdmin, type Location, useItems, useLocations, useMe, useRefresh } from '../api';
import ItemsTable from '../components/ItemsTable';
import ItemFormModal from '../components/ItemFormModal';
import { descendantIds, LOCATION_KINDS, norm, notifyError, notifyOk } from '../util';

const KIND_ICON: Record<string, typeof IconFolder> = {
  deposito: IconBuildingWarehouse,
  armario: IconArchive,
  lab: IconFlask,
  rack: IconServer2,
  estante: IconLayoutRows,
  otro: IconFolder,
};

function LocationModal({
  opened, onClose, location, parentId, locations,
}: { opened: boolean; onClose: () => void; location: Location | null; parentId: number | null; locations: Location[] }) {
  const refresh = useRefresh();
  const [v, setV] = useState({ name: '', parent_id: null as string | null, kind: 'otro' });
  const [lastKey, setLastKey] = useState('');
  const key = `${opened}-${location?.id}-${parentId}`;
  if (key !== lastKey) {
    setLastKey(key);
    setV(
      location
        ? { name: location.name, parent_id: location.parent_id ? String(location.parent_id) : null, kind: location.kind }
        : { name: '', parent_id: parentId ? String(parentId) : null, kind: parentId ? 'estante' : 'deposito' },
    );
  }

  const save = async () => {
    try {
      const body = { name: v.name, parent_id: v.parent_id ? Number(v.parent_id) : null, kind: v.kind };
      if (location) await api(`/api/locations/${location.id}`, { method: 'PUT', body });
      else await api('/api/locations', { body });
      notifyOk('Ubicación guardada');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={location ? 'Editar ubicación' : 'Nueva ubicación'}>
      <Stack>
        <TextInput label="Nombre" placeholder="ej: Armario 4, Estante 3" data-autofocus value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <Select label="Tipo" data={LOCATION_KINDS} value={v.kind} onChange={(k) => k && setV({ ...v, kind: k })} allowDeselect={false} />
        <Select
          label="Dentro de"
          placeholder="(nivel principal)"
          clearable
          searchable
          data={locations.filter((l) => l.id !== location?.id).map((l) => ({ value: String(l.id), label: l.path }))}
          value={v.parent_id}
          onChange={(p) => setV({ ...v, parent_id: p })}
        />
        <Group justify="flex-end">
          <Button onClick={save} disabled={!v.name.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Locations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: locations = [] } = useLocations();
  const { data: items = [] } = useItems();
  const refresh = useRefresh();
  const selectedId = id ? Number(id) : null;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ location: Location | null; parentId: number | null } | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const children = useMemo(() => {
    const m = new Map<number | null, Location[]>();
    for (const l of locations) m.set(l.parent_id, [...(m.get(l.parent_id) ?? []), l]);
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    return m;
  }, [locations]);

  // Cantidad de ítems incluyendo sub-ubicaciones.
  const totals = useMemo(() => {
    const t = new Map<number, number>();
    for (const l of locations) {
      let n = 0;
      for (const d of descendantIds(locations, l.id)) n += locations.find((x) => x.id === d)?.item_count ?? 0;
      t.set(l.id, n);
    }
    return t;
  }, [locations]);

  const current = locations.find((l) => l.id === selectedId) ?? null;
  const ancestors: Location[] = [];
  for (let p = current; p; p = locations.find((l) => l.id === p!.parent_id) ?? null) ancestors.unshift(p);

  const itemsHere = useMemo(() => {
    if (!selectedId) return [];
    const ids = descendantIds(locations, selectedId);
    const t = norm(q);
    return items.filter(
      (i) => i.location_id && ids.has(i.location_id) && (!t || norm([i.description, i.serial_number, i.code, i.category].join(' ')).includes(t)),
    );
  }, [items, locations, selectedId, q]);

  // Al elegir una ubicación (o entrar por link) se abren sus padres en el árbol.
  const ancestorKey = ancestors.map((a) => a.id).join(',');
  useEffect(() => {
    if (!ancestorKey) return;
    setExpanded((s) => {
      const n = new Set(s);
      for (const id of ancestorKey.split(',').map(Number)) if (id !== selectedId) n.add(id);
      return n;
    });
  }, [ancestorKey, selectedId]);

  const isOpen = (lid: number) => expanded.has(lid);
  const expandAll = () => setExpanded(new Set(locations.filter((l) => children.has(l.id)).map((l) => l.id)));
  const collapseAll = () => setExpanded(new Set());
  const toggle = (lid: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(lid)) n.delete(lid);
      else n.add(lid);
      return n;
    });

  const remove = (l: Location) =>
    modals.openConfirmModal({
      title: `Borrar ${l.path}`,
      children: <Text size="sm">Solo se puede borrar si está vacía y sin sub-ubicaciones.</Text>,
      labels: { confirm: 'Borrar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api(`/api/locations/${l.id}`, { method: 'DELETE' });
          notifyOk('Ubicación borrada');
          refresh();
          if (selectedId === l.id) navigate('/ubicaciones');
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const Node = ({ l, depth }: { l: Location; depth: number }) => {
    const kids = children.get(l.id) ?? [];
    const open = isOpen(l.id);
    const Icon = KIND_ICON[l.kind] ?? IconFolder;
    const active = l.id === selectedId;
    return (
      <>
        <Group
          gap={2}
          wrap="nowrap"
          pl={depth * 14}
          pr={8}
          className="tree-node"
          bg={active ? 'var(--mantine-primary-color-light)' : undefined}
        >
          <ActionIcon variant="subtle" color="gray" size="xs" onClick={() => toggle(l.id)} style={{ visibility: kids.length ? 'visible' : 'hidden' }}>
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <UnstyledButton onClick={() => navigate(`/ubicaciones/${l.id}`)} style={{ flex: 1, minWidth: 0 }} py={3}>
            <Group gap={6} wrap="nowrap">
              <Icon size={15} opacity={0.7} />
              <Text size="sm" fw={active ? 600 : 400} truncate>
                {l.name}
              </Text>
            </Group>
          </UnstyledButton>
          <Text size="xs" c={active ? undefined : 'dimmed'} fw={500} style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
            {totals.get(l.id) ?? 0}
          </Text>
        </Group>
        {open && kids.map((k) => <Node key={k.id} l={k} depth={depth + 1} />)}
      </>
    );
  };

  const roots = children.get(null) ?? [];
  const write = canWrite(me?.user);

  return (
    <Stack>
      <Group justify="space-between" className="no-print">
        <Title order={2}>Ubicaciones</Title>
        {write && (
          <Button leftSection={<IconPlus size={16} />} variant="default" onClick={() => setModal({ location: null, parentId: null })}>
            Nueva ubicación
          </Button>
        )}
      </Group>

      <Flex gap="md" direction={{ base: 'column', md: 'row' }} align={{ base: 'stretch', md: 'flex-start' }}>
        <Box w={{ base: '100%', md: 230 }} style={{ flex: 'none' }} className="no-print">
          <Card withBorder padding={6}>
            <Group gap={4} justify="flex-end" mb={4}>
              <Tooltip label="Expandir todo">
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={expandAll} aria-label="Expandir todo">
                  <IconFoldDown size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Colapsar todo">
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={collapseAll} aria-label="Colapsar todo">
                  <IconFoldUp size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <ScrollArea.Autosize mah="calc(100vh - 220px)" offsetScrollbars="y" scrollbarSize={6}>
              {roots.map((l) => (
                <Node key={l.id} l={l} depth={0} />
              ))}
              {roots.length === 0 && (
                <Text c="dimmed" size="sm" p="sm">
                  No hay ubicaciones. Creá una o importá el Excel.
                </Text>
              )}
            </ScrollArea.Autosize>
          </Card>
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          {!current ? (
            <Card withBorder>
              <Text c="dimmed">Elegí una ubicación para ver qué hay adentro.</Text>
            </Card>
          ) : (
            <Stack>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Breadcrumbs separator="›">
                    {ancestors.map((a) => (
                      <Anchor key={a.id} size="sm" onClick={() => navigate(`/ubicaciones/${a.id}`)}>
                        {a.name}
                      </Anchor>
                    ))}
                  </Breadcrumbs>
                  <Title order={3} mt={4}>
                    {current.path}
                  </Title>
                  <Text c="dimmed" size="sm">
                    {itemsHere.length} {itemsHere.length === 1 ? 'ítem' : 'ítems'}{(children.get(current.id) ?? []).length ? ' (incluye lo que hay en sus sub-ubicaciones)' : ''}
                  </Text>
                </div>
                <Group gap="xs" className="no-print">
                  {write && (
                    <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNewItem(true)}>
                      Agregar ítem acá
                    </Button>
                  )}
                  <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => window.print()}>
                    Imprimir listado
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconQrcode size={14} />}
                    onClick={() => navigate(`/etiquetas?ids=${(selected.size ? [...selected] : itemsHere.map((i) => i.id)).join(',')}`)}
                    disabled={!itemsHere.length}
                  >
                    Etiquetas{selected.size ? ` (${selected.size})` : ''}
                  </Button>
                  {write && (
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="default" size="md">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => setModal({ location: null, parentId: current.id })}>
                          Agregar sub-ubicación (estante…)
                        </Menu.Item>
                        <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setModal({ location: current, parentId: null })}>
                          Renombrar / mover
                        </Menu.Item>
                        {isAdmin(me?.user) && (
                          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => remove(current)}>
                            Borrar
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              </Group>

              {(children.get(current.id) ?? []).length > 0 && (
                <Group gap="xs" className="no-print">
                  {(children.get(current.id) ?? []).map((k) => (
                    <Button key={k.id} size="xs" variant="light" radius="xl" onClick={() => navigate(`/ubicaciones/${k.id}`)}>
                      {k.name} · {totals.get(k.id) ?? 0}
                    </Button>
                  ))}
                </Group>
              )}

              <TextInput
                className="no-print"
                placeholder={`Buscar en ${current.name}`}
                leftSection={<IconSearch size={16} />}
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
              <Box>
                <ItemsTable items={itemsHere} hideLocation selected={selected} onSelectedChange={setSelected} pageSize={500} />
              </Box>
            </Stack>
          )}
        </Box>
      </Flex>

      <LocationModal
        opened={!!modal}
        onClose={() => setModal(null)}
        location={modal?.location ?? null}
        parentId={modal?.parentId ?? null}
        locations={locations}
      />
      <ItemFormModal opened={newItem} onClose={() => setNewItem(false)} defaultLocationId={selectedId} />
    </Stack>
  );
}
