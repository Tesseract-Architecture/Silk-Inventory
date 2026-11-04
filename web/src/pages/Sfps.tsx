// Vista tipo planilla de los SFP: agrupados por caja/ubicación, una columna por modelo
// con la cantidad, y los números de serie uno abajo del otro.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon, Autocomplete, Badge, Box, Button, Group, Loader, Modal, ScrollArea, Select, Stack, Text, Textarea, TextInput, Title, Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { api, ApiError, canWrite, type Item, type ModelStock, useCategories, useItems, useLocations, useMe, useRefresh } from '../api';
import { locationOptions, norm, notifyError, notifyOk, STATUS } from '../util';

// La categoría de los SFP se reconoce por el nombre ("SFP y transceivers", "SFP / Ópticos"…), así un renombre no la rompe.
const isSfpCategory = (name: string) => /^sfp/i.test(name.trim());

interface Column {
  model: string;
  units: Item[];
  loose: Item[];
  total: number;
  available: number;
}

interface Group {
  locationId: number | null;
  name: string;
  columns: Column[];
}

const normModel = (s: string) => s.trim().toUpperCase().replace(/=$/, '').replace(/\s+/g, '');

function AddModal({
  target, onClose, categoryId, models,
}: { target: { model: string; locationId: number | null } | null; onClose: () => void; categoryId: number | null; models: string[] }) {
  const { data: locations = [] } = useLocations();
  const refresh = useRefresh();
  const [model, setModel] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [serials, setSerials] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastKey, setLastKey] = useState('');
  const key = `${target?.model}-${target?.locationId}`;
  if (target && key !== lastKey) {
    setLastKey(key);
    setModel(target.model);
    setLocationId(target.locationId ? String(target.locationId) : null);
    setSerials('');
  }

  const list = serials.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

  const save = async () => {
    setSaving(true);
    const errors: string[] = [];
    let ok = 0;
    for (const serial of list) {
      try {
        await api('/api/items', {
          body: {
            description: model.trim(),
            part_number: normModel(model),
            serial_number: serial,
            category_id: categoryId,
            location_id: locationId ? Number(locationId) : null,
            kind: 'unidad',
          },
        });
        ok++;
      } catch (e) {
        errors.push(e instanceof ApiError && e.status === 409 ? `${serial}: ya existe` : `${serial}: ${(e as Error).message}`);
      }
    }
    setSaving(false);
    refresh();
    if (ok) notifyOk(`${ok} SFP agregados`);
    if (errors.length) notifyError(new Error(errors.join(' · ')));
    else onClose();
  };

  return (
    <Modal opened={!!target} onClose={onClose} title="Agregar SFPs">
      <Stack>
        <Autocomplete
          label="Modelo"
          description="Elegí uno existente o escribí uno nuevo"
          placeholder="SFP-10G-SR-S"
          data={models}
          limit={30}
          value={model}
          onChange={(v) => setModel(v.toUpperCase())}
          data-autofocus={!model || undefined}
        />
        <Select label="Caja / ubicación" searchable data={locationOptions(locations)} value={locationId} onChange={setLocationId} />
        <Textarea
          label="Números de serie"
          description="Uno por línea (podés pegar una columna del Excel)"
          autosize
          minRows={5}
          data-autofocus
          value={serials}
          onChange={(e) => setSerials(e.currentTarget.value)}
          classNames={{ input: 'mono' }}
        />
        <Group justify="flex-end">
          <Button onClick={save} loading={saving} disabled={!model.trim() || !list.length}>
            Agregar {list.length || ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Sfps() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: items = [], isLoading } = useItems();
  const { data: categories = [] } = useCategories();
  const { data: locations = [], isLoading: loadingLocations } = useLocations();
  const { data: rules = [] } = useQuery({ queryKey: ['model-stock'], queryFn: () => api<ModelStock[]>('/api/model-stock') });
  const [q, setQ] = useState('');
  const [add, setAdd] = useState<{ model: string; locationId: number | null } | null>(null);
  const write = canWrite(me?.user);

  const category = categories.find((c) => isSfpCategory(c.name));
  const ruleByModel = new Map(rules.map((r) => [r.model, r]));
  // Modelos para autocompletar: los que ya hay en las cajas + los de la lista de stock mínimo.
  const knownModels = useMemo(() => {
    const byNorm = new Map<string, string>();
    for (const i of items) if (i.category_id === category?.id) byNorm.set(normModel(i.description), i.description);
    for (const r of rules) if (!byNorm.has(r.model)) byNorm.set(r.model, r.model);
    return [...byNorm.values()].sort((a, b) => a.localeCompare(b));
  }, [items, rules, category?.id]);

  const groups = useMemo(() => {
    const byLoc = new Map<string, Group>();
    // Orden: el del inventario (id), así quedan como en la planilla original.
    for (const i of [...items].sort((a, b) => a.id - b.id)) {
      if (i.category_id !== category?.id) continue;
      const locKey = String(i.location_id ?? 'none');
      let g = byLoc.get(locKey);
      if (!g) {
        const loc = locations.find((l) => l.id === i.location_id);
        g = { locationId: i.location_id, name: loc?.path ?? 'Sin ubicación', columns: [] };
        byLoc.set(locKey, g);
      }
      const model = i.description;
      let col = g.columns.find((c) => normModel(c.model) === normModel(model));
      if (!col) {
        col = { model, units: [], loose: [], total: 0, available: 0 };
        g.columns.push(col);
      }
      const qty = i.kind === 'consumible' ? i.quantity : 1;
      if (i.kind === 'consumible') col.loose.push(i);
      else col.units.push(i);
      col.total += qty;
      if (i.status === 'disponible') col.available += qty;
    }
    return [...byLoc.values()];
  }, [items, category?.id, locations]);

  const t = norm(q);
  const matches = (i: Item) => !t || norm(`${i.serial_number} ${i.description}`).includes(t);
  const totalUnits = groups.reduce((n, g) => n + g.columns.reduce((m, c) => m + c.total, 0), 0);

  if (isLoading || loadingLocations) return <Loader />;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>SFPs</Title>
          <Text size="sm" c="dimmed">
            {totalUnits} en total · tocá un número de serie para ver su ficha
          </Text>
        </div>
        <Group gap="xs">
          <TextInput
            placeholder="Buscar serie o modelo"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={240}
          />
          {write && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAdd({ model: '', locationId: groups[0]?.locationId ?? null })}>
              Agregar SFPs
            </Button>
          )}
        </Group>
      </Group>

      {groups.length === 0 && <Text c="dimmed">No hay ítems en una categoría que empiece con “SFP”.</Text>}

      {groups.map((g) => {
        const cols = g.columns.filter((c) => !t || norm(c.model).includes(t) || [...c.units, ...c.loose].some(matches));
        if (!cols.length) return null;
        return (
          <Box key={String(g.locationId)}>
            <Box bg="var(--mantine-primary-color-filled)" c="var(--mantine-primary-color-contrast)" px="sm" py={4} style={{ borderRadius: '8px 8px 0 0' }}>
              <Group justify="space-between">
                <Text fw={700} size="sm">
                  {g.name}
                </Text>
                <Text size="xs">{cols.reduce((n, c) => n + c.total, 0)} SFPs</Text>
              </Group>
            </Box>
            <ScrollArea type="auto" offsetScrollbars>
              <Group
                gap={0}
                wrap="nowrap"
                align="stretch"
                style={{ border: '1px solid var(--mantine-color-default-border)', borderTop: 0, width: 'max-content', minWidth: '100%' }}
              >
                {cols.map((c) => {
                  const rule = ruleByModel.get(normModel(c.model));
                  return (
                    <Box key={c.model} w={165} style={{ borderRight: '1px solid var(--mantine-color-default-border)' }}>
                      <Box
                        px={8}
                        py={6}
                        h={54}
                        bg="var(--mantine-color-default-hover)"
                        style={{ borderBottom: '1px solid var(--mantine-color-default-border)', overflow: 'hidden' }}
                      >
                        <Group gap={4} justify="space-between" wrap="nowrap" align="flex-start">
                          <Text fw={700} size="xs" title={c.model} truncate>
                            {c.model}
                          </Text>
                          <Tooltip
                            label={
                              `${c.available} disponibles de ${c.total}` +
                              (rule ? ` · mínimo ${rule.min_qty} (total disponible en todas las cajas: ${rule.available})` : '')
                            }
                          >
                            <Badge
                              size="sm"
                              variant="filled"
                              color={rule && rule.available < rule.min_qty ? 'red' : 'indigo'}
                              style={{ flex: 'none', overflow: 'visible' }}
                            >
                              {c.total}
                            </Badge>
                          </Tooltip>
                        </Group>
                        {write && (
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            mt={2}
                            onClick={() => setAdd({ model: c.model, locationId: g.locationId })}
                            aria-label={`Agregar ${c.model}`}
                          >
                            <IconPlus size={12} />
                          </ActionIcon>
                        )}
                      </Box>
                      <Stack gap={0} py={2}>
                        {c.units.map((i) => {
                          const hit = t && matches(i);
                          const s = STATUS[i.status];
                          return (
                            <UnstyledButton
                              key={i.id}
                              className="serial-cell"
                              title={`${i.code} · ${i.description} · ${s.label} — abrir ficha`}
                              onClick={() => navigate(`/items/${i.id}`)}
                              px={8}
                              py={1}
                              bg={hit ? 'var(--mantine-color-yellow-light)' : undefined}
                            >
                              <Group gap={4} wrap="nowrap">
                                <Text size="xs" className="mono" truncate td={i.status === 'baja' ? 'line-through' : undefined}>
                                  {i.serial_number ?? '(sin serie)'}
                                </Text>
                                {i.status !== 'disponible' && (
                                  <Tooltip label={`${s.label}${i.loan_contact ? ` a ${i.loan_contact}` : ''}`}>
                                    <Badge size="xs" color={s.color} variant="light" style={{ flex: 'none' }}>
                                      {s.label.slice(0, 4)}.
                                    </Badge>
                                  </Tooltip>
                                )}
                              </Group>
                            </UnstyledButton>
                          );
                        })}
                        {c.loose.map((i) => (
                          <UnstyledButton key={i.id} className="serial-cell" onClick={() => navigate(`/items/${i.id}`)} px={8} py={1}>
                            <Text size="xs" c="dimmed" fs="italic">
                              + {i.quantity} sueltos sin serie
                            </Text>
                          </UnstyledButton>
                        ))}
                      </Stack>
                    </Box>
                  );
                })}
              </Group>
            </ScrollArea>
          </Box>
        );
      })}

      <AddModal target={add} onClose={() => setAdd(null)} categoryId={category?.id ?? null} models={knownModels} />
    </Stack>
  );
}
