import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Checkbox, Group, Pagination, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconBoxOff, IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { Item } from '../api';
import { fmtLoanDate, StatusBadge } from '../util';

type SortKey = 'code' | 'description' | 'category' | 'location' | 'serial_number' | 'status' | 'quantity';

interface Props {
  items: Item[];
  selected?: Set<number>;
  onSelectedChange?: (s: Set<number>) => void;
  hideLocation?: boolean;
  pageSize?: number;
}

export default function ItemsTable({ items, selected, onSelectedChange, hideLocation, pageSize = 100 }: Props) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: hideLocation ? 'location' : 'code', dir: 1 });
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb), 'es', { numeric: true }) * sort.dir;
    });
    return arr;
  }, [items, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);

  const Th = ({ k, children, w }: { k: SortKey; children: React.ReactNode; w?: number }) => {
    const Icon = sort.key === k ? (sort.dir === 1 ? IconChevronUp : IconChevronDown) : IconSelector;
    return (
      <Table.Th w={w}>
        <UnstyledButton onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
          <Group gap={4} wrap="nowrap">
            <Text fw={600} size="sm">
              {children}
            </Text>
            <Icon size={14} opacity={0.5} />
          </Group>
        </UnstyledButton>
      </Table.Th>
    );
  };

  const allVisibleSelected = !!selected && visible.length > 0 && visible.every((i) => selected.has(i.id));
  const toggle = (id: number) => {
    if (!selected || !onSelectedChange) return;
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onSelectedChange(s);
  };

  return (
    <>
      <Table.ScrollContainer minWidth={800}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              {selected && (
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Seleccionar página"
                    checked={allVisibleSelected}
                    indeterminate={!allVisibleSelected && visible.some((i) => selected.has(i.id))}
                    onChange={() => {
                      const s = new Set(selected);
                      for (const i of visible) {
                        if (allVisibleSelected) s.delete(i.id);
                        else s.add(i.id);
                      }
                      onSelectedChange?.(s);
                    }}
                  />
                </Table.Th>
              )}
              <Th k="code" w={95}>Código</Th>
              <Th k="description">Descripción / Modelo</Th>
              <Th k="category">Categoría</Th>
              {!hideLocation && <Th k="location">Ubicación</Th>}
              {hideLocation && <Th k="location">Lugar</Th>}
              <Th k="serial_number">N° de serie</Th>
              <Th k="status">Estado</Th>
              <Th k="quantity" w={70}>Cant.</Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((i) => (
              <Table.Tr key={i.id} className="clickable-row" onClick={() => navigate(`/items/${i.id}`)}>
                {selected && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label="Seleccionar" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  </Table.Td>
                )}
                <Table.Td className="mono">{i.code}</Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{i.description}</Text>
                    {!!i.box_mismatch && (
                      <Tooltip label="La caja no corresponde">
                        <IconBoxOff size={15} color="var(--mantine-color-yellow-6)" />
                      </Tooltip>
                    )}
                    {i.min_stock != null && i.quantity <= i.min_stock && (
                      <Tooltip label={`Bajo stock mínimo (${i.min_stock})`}>
                        <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
                      </Tooltip>
                    )}
                  </Group>
                  {i.notes && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {i.notes}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{i.category}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{i.location ?? '—'}</Text>
                </Table.Td>
                <Table.Td className="mono">{i.serial_number}</Table.Td>
                <Table.Td>
                  <StatusBadge status={i.status} />
                  {i.status === 'en_uso' && i.assigned_name && (
                    <Text size="xs" c="dimmed">
                      lo tiene {i.assigned_name.split(' ')[0]}
                    </Text>
                  )}
                  {i.loan_contact && (
                    <Text size="xs" c="dimmed">
                      {i.loan_company && i.loan_company !== i.loan_contact ? `${i.loan_contact} (${i.loan_company})` : i.loan_contact}
                      {i.loaned_at ? ` · ${fmtLoanDate(i.loaned_at, i.loan_date_unknown)}` : ''}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {i.kind === 'consumible' ? (
                    <Badge variant="outline" color={i.min_stock != null && i.quantity <= i.min_stock ? 'red' : 'gray'}>
                      {i.quantity} {i.unit ?? ''}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      1
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {visible.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <Text c="dimmed" ta="center" py="lg">
                    No hay ítems para mostrar
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {pages > 1 && (
        <Group justify="center" mt="md" className="no-print">
          <Pagination total={pages} value={current} onChange={setPage} />
        </Group>
      )}
    </>
  );
}
