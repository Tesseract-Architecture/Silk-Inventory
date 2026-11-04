import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, NumberInput, SegmentedControl, SimpleGrid, Stack, Table, Tabs,
  Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArrowBackUp, IconArrowLeft, IconBoxOff, IconEdit, IconHandGrab, IconPackageImport, IconQrcode, IconTrash,
} from '@tabler/icons-react';
import { api, canWrite, isAdmin, type Item, type Loan, type Movement, useCategories, useMe, useRefresh } from '../api';
import ItemFormModal from '../components/ItemFormModal';
import LoanFormModal from '../components/LoanFormModal';
import { ReturnModal } from './Loans';
import { ACTION_LABELS, describeDetail, fmtDate, fmtDateTime, fmtLoanDate, fmtPhone, notifyError, notifyOk, StatusBadge } from '../util';

interface ItemDetailData {
  item: Item;
  movements: Movement[];
  loans: (Loan & { contact: string; company: string | null; phone: string | null })[];
}

export function useRevert() {
  const refresh = useRefresh();
  return (m: Movement) =>
    modals.openConfirmModal({
      title: 'Deshacer movimiento',
      children: (
        <Text size="sm">
          ¿Deshacer “{ACTION_LABELS[m.action]?.label ?? m.action}” de {m.user ?? 'sistema'} del {fmtDateTime(m.created_at)}? Queda
          registrado quién lo deshizo.
        </Text>
      ),
      labels: { confirm: 'Deshacer', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api(`/api/activity/${m.id}/revert`, { method: 'POST' });
          notifyOk('Movimiento deshecho');
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });
}

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: categories = [] } = useCategories();
  const refresh = useRefresh();
  const revert = useRevert();
  const { data, isLoading, error } = useQuery({
    queryKey: ['item', Number(id)],
    queryFn: () => api<ItemDetailData>(`/api/items/${id}`),
  });
  const [editOpen, setEditOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  const [returnLoan, setReturnLoan] = useState<Loan | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adj, setAdj] = useState<{ dir: 'entrada' | 'salida'; qty: number; reason: string }>({ dir: 'salida', qty: 1, reason: '' });

  if (isLoading) return <Loader />;
  if (error || !data) return <Alert color="red">{(error as Error)?.message ?? 'No encontrado'}</Alert>;
  const { item, movements, loans } = data;
  const activeLoan = loans.find((l) => !l.returned_at);
  const write = canWrite(me?.user);
  const catNames = new Map(categories.map((c) => [c.id, c.name]));

  const adjust = async () => {
    try {
      await api(`/api/items/${item.id}/adjust`, { body: { delta: adj.dir === 'entrada' ? adj.qty : -adj.qty, reason: adj.reason } });
      notifyOk('Stock actualizado');
      setAdjustOpen(false);
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  const baja = () =>
    modals.openConfirmModal({
      title: `Dar de baja ${item.code}`,
      children: <Text size="sm">El ítem deja de aparecer en el inventario pero queda su historial. Se puede deshacer desde Actividad.</Text>,
      labels: { confirm: 'Dar de baja', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api(`/api/items/${item.id}`, { method: 'DELETE', body: {} });
          notifyOk('Ítem dado de baja');
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm">{children || '—'}</Text>
    </div>
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Anchor size="sm" onClick={() => navigate(-1)}>
            <Group gap={4}>
              <IconArrowLeft size={14} /> Volver
            </Group>
          </Anchor>
          <Group gap="sm" mt={4}>
            <Title order={2}>{item.description}</Title>
            <StatusBadge status={item.status} />
            {!!item.box_mismatch && (
              <Badge color="yellow" variant="light" leftSection={<IconBoxOff size={12} />}>
                Caja no corresponde
              </Badge>
            )}
          </Group>
          <Text c="dimmed" className="mono">
            {item.code}
            {item.serial_number ? ` · S/N ${item.serial_number}` : ''}
          </Text>
        </div>
        <Group gap="xs">
          {write && (
            <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
          )}
          {write && item.kind === 'consumible' && (
            <Button variant="default" leftSection={<IconPackageImport size={16} />} onClick={() => setAdjustOpen(true)}>
              Entrada / salida
            </Button>
          )}
          {write && activeLoan && item.kind === 'unidad' ? (
            <Button color="green" leftSection={<IconArrowBackUp size={16} />} onClick={() => setReturnLoan(activeLoan)}>
              Registrar devolución
            </Button>
          ) : (
            write &&
            item.status !== 'baja' && (
              <Button leftSection={<IconHandGrab size={16} />} onClick={() => setLoanOpen(true)}>
                Prestar
              </Button>
            )
          )}
          <Tooltip label="Etiqueta QR">
            <Button variant="default" px="xs" component={Link} to={`/etiquetas?ids=${item.id}`}>
              <IconQrcode size={18} />
            </Button>
          </Tooltip>
          {isAdmin(me?.user) && item.status !== 'baja' && (
            <Tooltip label="Dar de baja">
              <Button variant="default" color="red" px="xs" onClick={baja}>
                <IconTrash size={18} />
              </Button>
            </Tooltip>
          )}
        </Group>
      </Group>

      {activeLoan && (
        <Alert color="orange" icon={<IconHandGrab />} title={`Prestado a ${activeLoan.contact}${activeLoan.company && activeLoan.company !== activeLoan.contact ? ` (${activeLoan.company})` : ''}`}>
          {activeLoan.date_unknown ? 'Sin fecha conocida' : `Desde el ${fmtDate(activeLoan.loaned_at)}`}
          {activeLoan.due_date ? ` · devuelve el ${fmtDate(activeLoan.due_date)}` : ''}
          {(activeLoan as Loan & { responsible_name?: string | null }).responsible_name
            ? ` · responsable: ${(activeLoan as Loan & { responsible_name?: string | null }).responsible_name}`
            : ''}
          {activeLoan.reminder_count > 0 && ` · ${activeLoan.reminder_count} recordatorio(s) enviados`}
        </Alert>
      )}

      <Card withBorder>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }}>
          <Field label="Ubicación">
            {item.location_id ? (
              <Anchor component={Link} to={`/ubicaciones/${item.location_id}`} inherit>
                {item.location}
              </Anchor>
            ) : null}
          </Field>
          <Field label="Categoría">{item.category}</Field>
          <Field label="Marca">{item.brand}</Field>
          <Field label="Part number">{item.part_number}</Field>
          <Field label="N° de serie">{item.serial_number}</Field>
          <Field label="Tipo">{item.kind === 'consumible' ? 'Consumible' : 'Unidad'}</Field>
          {item.status === 'en_uso' && <Field label="Lo tiene">{item.assigned_name}</Field>}
          {item.kind === 'consumible' && (
            <>
              <Field label="Cantidad">
                {item.quantity} {item.unit ?? ''}
              </Field>
              <Field label="Stock mínimo">{item.min_stock ?? null}</Field>
            </>
          )}
        </SimpleGrid>
        {item.notes && (
          <Text size="sm" mt="md" style={{ whiteSpace: 'pre-wrap' }}>
            <b>Notas:</b> {item.notes}
          </Text>
        )}
      </Card>

      <Tabs defaultValue="historial">
        <Tabs.List>
          <Tabs.Tab value="historial">Historial ({movements.length})</Tabs.Tab>
          <Tabs.Tab value="prestamos">Préstamos ({loans.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="historial" pt="sm">
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Tbody>
                {movements.map((m) => (
                  <Table.Tr key={m.id} style={m.reverted_at ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                    <Table.Td w={150}>
                      <Text size="sm">{fmtDateTime(m.created_at)}</Text>
                    </Table.Td>
                    <Table.Td w={120}>
                      <Badge variant="light" color={ACTION_LABELS[m.action]?.color ?? 'gray'}>
                        {ACTION_LABELS[m.action]?.label ?? m.action}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{describeDetail(m.action, m.detail, { categories: catNames })}</Text>
                    </Table.Td>
                    <Table.Td w={160}>
                      <Text size="sm">{m.user ?? 'sistema'}</Text>
                    </Table.Td>
                    <Table.Td w={90}>
                      {isAdmin(me?.user) && !m.reverted_at && m.action !== 'deshacer' && (
                        <Button size="compact-xs" variant="subtle" color="red" onClick={() => revert(m)}>
                          Deshacer
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="prestamos" pt="sm">
          {loans.length === 0 ? (
            <Text c="dimmed">Nunca se prestó.</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>A quién</Table.Th>
                  <Table.Th>Desde</Table.Th>
                  <Table.Th>Devuelto</Table.Th>
                  <Table.Th>Prestó</Table.Th>
                  <Table.Th>Notas</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {loans.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      {l.contact}
                      {l.company && l.company !== l.contact ? ` (${l.company})` : ''}
                    </Table.Td>
                    <Table.Td>{fmtLoanDate(l.loaned_at, l.date_unknown)}</Table.Td>
                    <Table.Td>{l.returned_at ? fmtDate(l.returned_at) : <Badge color="orange">Prestado</Badge>}</Table.Td>
                    <Table.Td>{(l as any).loaned_by_name ?? '—'}</Table.Td>
                    <Table.Td>
                      <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                        {l.notes}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>
      </Tabs>

      <ItemFormModal opened={editOpen} onClose={() => setEditOpen(false)} item={item} />
      <LoanFormModal opened={loanOpen} onClose={() => setLoanOpen(false)} itemIds={[item.id]} />
      <ReturnModal loan={returnLoan} onClose={() => setReturnLoan(null)} />
      <Modal opened={adjustOpen} onClose={() => setAdjustOpen(false)} title={`Stock de ${item.description}`}>
        <Stack>
          <Text size="sm">
            Hay {item.quantity} {item.unit ?? ''}
          </Text>
          <SegmentedControl
            value={adj.dir}
            onChange={(d) => setAdj({ ...adj, dir: d as 'entrada' | 'salida' })}
            data={[
              { value: 'salida', label: 'Saco / uso' },
              { value: 'entrada', label: 'Entra / compra' },
            ]}
          />
          <NumberInput label="Cantidad" min={1} value={adj.qty} onChange={(x) => setAdj({ ...adj, qty: Number(x) || 1 })} />
          <TextInput
            label="Motivo"
            placeholder="ej: para obra X, compra OC 123"
            value={adj.reason}
            onChange={(e) => setAdj({ ...adj, reason: e.currentTarget.value })}
          />
          <Group justify="flex-end">
            <Button onClick={adjust}>Guardar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
