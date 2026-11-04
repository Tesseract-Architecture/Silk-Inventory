import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionIcon, Anchor, Badge, Button, Checkbox, Group, Loader, Menu, Modal, NumberInput, SegmentedControl, Select, Stack, Switch, Table,
  Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconArrowBackUp, IconBrandWhatsapp, IconChevronDown, IconDots, IconEdit, IconExternalLink, IconPlus, IconSearch,
} from '@tabler/icons-react';
import { api, canWrite, type Loan, useLoans, useMe, useRefresh, useUsers } from '../api';
import LoanFormModal from '../components/LoanFormModal';
import NotifyModal, { type NotifyKind } from '../components/NotifyModal';
import { fmtDate, fmtPhone, norm, notifyError, notifyOk, todayIso, waLink } from '../util';

export function ReturnModal({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [date, setDate] = useState<string | null>(todayIso());
  const [notes, setNotes] = useState('');
  const [consumed, setConsumed] = useState(false);
  useEffect(() => {
    setDate(todayIso());
    setNotes('');
    setConsumed(false);
  }, [loan]);

  const save = async () => {
    try {
      await api(`/api/loans/${loan!.id}/return`, { body: { returned_at: date, notes, consumed } });
      notifyOk('Devolución registrada');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  const name = loan?.contact_name ?? (loan as any)?.contact;
  return (
    <Modal opened={!!loan} onClose={onClose} title="Registrar devolución">
      {loan && (
        <Stack>
          <Text size="sm">
            {loan.item_description ?? ''} {name ? `— devuelve ${name}` : ''}
          </Text>
          <DateInput label="Fecha de devolución" value={date} onChange={setDate} />
          {(loan.item_kind ?? '') === 'consumible' && (
            <Checkbox
              label="No vuelve (se consumió / se lo quedaron)"
              checked={consumed}
              onChange={(e) => setConsumed(e.currentTarget.checked)}
            />
          )}
          <Textarea label="Notas" placeholder="ej: volvió sin fuente" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button color="green" onClick={save}>
              Registrar devolución
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** A quién le llega el recordatorio de este préstamo, para mostrarlo. */
function remindTarget(l: Loan): string {
  if (l.responsible_phone) return `${l.responsible_name} (${fmtPhone(l.responsible_phone)})`;
  if (l.remind_to) return l.remind_to.includes('@g.us') ? 'el grupo interno' : `el número interno (${fmtPhone(l.remind_to)})`;
  return '';
}

function RemindModal({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!loan) return;
    api<{ message: string }>(`/api/loans/${loan.id}/message`).then((r) => setMessage(r.message), notifyError);
  }, [loan]);

  const send = async () => {
    setSending(true);
    try {
      await api(`/api/loans/${loan!.id}/remind`, { body: { message } });
      notifyOk(`Recordatorio enviado a ${remindTarget(loan!)}`);
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal opened={!!loan} onClose={onClose} title="Recordatorio para reclamar" size="lg">
      {loan && (
        <Stack>
          <Text size="sm" c="dimmed">
            Para: {remindTarget(loan) || 'nadie (sin responsable con WhatsApp ni número interno)'}
          </Text>
          <Textarea autosize minRows={4} value={message} onChange={(e) => setMessage(e.currentTarget.value)} />
          <Group justify="space-between">
            {loan.remind_to && !loan.remind_to.includes('@') ? (
              <Button
                variant="subtle"
                component="a"
                href={waLink(loan.remind_to, message)}
                target="_blank"
                leftSection={<IconExternalLink size={16} />}
              >
                Abrir en mi WhatsApp
              </Button>
            ) : (
              <span />
            )}
            <Button color="green" leftSection={<IconBrandWhatsapp size={16} />} onClick={send} loading={sending} disabled={!loan.remind_to}>
              Enviar desde el sistema
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function EditLoanModal({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const refresh = useRefresh();
  const { data: users = [] } = useUsers();
  const [v, setV] = useState({
    loaned_at: '',
    due_date: null as string | null,
    notes: '',
    reminders_paused: false,
    reminder_every_days: '' as number | '',
    responsible_id: null as string | null,
  });
  useEffect(() => {
    if (loan)
      setV({
        loaned_at: loan.loaned_at,
        due_date: loan.due_date,
        notes: loan.notes ?? '',
        reminders_paused: !!loan.reminders_paused,
        reminder_every_days: loan.reminder_every_days ?? '',
        responsible_id: loan.responsible_id ? String(loan.responsible_id) : null,
      });
  }, [loan]);

  const save = async () => {
    try {
      await api(`/api/loans/${loan!.id}`, {
        method: 'PUT',
        body: {
          ...v,
          reminder_every_days: v.reminder_every_days === '' ? null : v.reminder_every_days,
          responsible_id: v.responsible_id ? Number(v.responsible_id) : null,
        },
      });
      notifyOk('Préstamo actualizado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Modal opened={!!loan} onClose={onClose} title="Editar préstamo">
      <Stack>
        <DateInput label="Fecha de préstamo" value={v.loaned_at} onChange={(x) => setV({ ...v, loaned_at: x ?? v.loaned_at })} />
        <DateInput label="Devolución prevista" clearable value={v.due_date} onChange={(x) => setV({ ...v, due_date: x })} />
        <Select
          label="¿Quién de Silk lo prestó?"
          description="Le llegan los recordatorios para reclamarlo"
          searchable
          clearable
          placeholder="Sin responsable (va al número/grupo interno)"
          data={users.map((u) => ({ value: String(u.id), label: u.has_phone ? u.name : `${u.name} (sin WhatsApp cargado)` }))}
          value={v.responsible_id}
          onChange={(x) => setV({ ...v, responsible_id: x })}
        />
        <NumberInput
          label="Recordar cada (días)"
          placeholder="Por defecto"
          min={1}
          value={v.reminder_every_days}
          onChange={(x) => setV({ ...v, reminder_every_days: x === '' ? '' : Number(x) })}
        />
        <Switch
          label="Pausar recordatorios automáticos"
          checked={v.reminders_paused}
          onChange={(e) => setV({ ...v, reminders_paused: e.currentTarget.checked })}
        />
        <Textarea label="Notas" autosize value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button onClick={save}>Guardar</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Loans() {
  const [status, setStatus] = useState<'active' | 'returned' | 'all'>('active');
  const { data: loans = [], isLoading } = useLoans(status);
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [remind, setRemind] = useState<Loan | null>(null);
  const [ret, setRet] = useState<Loan | null>(null);
  const [edit, setEdit] = useState<Loan | null>(null);
  const [notify, setNotify] = useState<NotifyKind | null>(null);
  const write = canWrite(me?.user);

  const filtered = useMemo(() => {
    const t = norm(q);
    return t
      ? loans.filter((l) =>
          norm([l.item_description, l.item_code, l.serial_number, l.contact_name, l.contact_company, l.responsible_name].join(' ')).includes(t),
        )
      : loans;
  }, [loans, q]);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Préstamos</Title>
        {write && (
          <Group gap="xs">
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconBrandWhatsapp size={16} />} rightSection={<IconChevronDown size={14} />}>
                  Avisar por WhatsApp
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setNotify('responsibles')}>A cada responsable, lo suyo</Menu.Item>
                <Menu.Item onClick={() => setNotify('loans')}>Resumen de todo lo prestado</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setNewOpen(true)}>
              Nuevo préstamo
            </Button>
          </Group>
        )}
      </Group>
      <Group>
        <SegmentedControl
          value={status}
          onChange={(s) => setStatus(s as typeof status)}
          data={[
            { value: 'active', label: 'Prestados' },
            { value: 'returned', label: 'Devueltos' },
            { value: 'all', label: 'Todos' },
          ]}
        />
        <TextInput placeholder="Buscar" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      </Group>

      {isLoading ? (
        <Loader />
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ítem</Table.Th>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Lo prestó</Table.Th>
                <Table.Th>Desde</Table.Th>
                <Table.Th>Devolución</Table.Th>
                <Table.Th>Recordatorios</Table.Th>
                <Table.Th w={140} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/items/${l.item_id}`} size="sm">
                      {l.quantity !== 1 ? `${l.quantity} × ` : ''}
                      {l.item_description}
                    </Anchor>
                    <Text size="xs" c="dimmed" className="mono">
                      {l.item_code}
                      {l.serial_number ? ` · ${l.serial_number}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{l.contact_name}</Text>
                    {l.contact_company && l.contact_company !== l.contact_name && (
                      <Text size="xs" c="dimmed">
                        {l.contact_company}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {l.responsible_name ? (
                      <>
                        <Text size="sm">{l.responsible_name}</Text>
                        {!l.responsible_phone && (
                          <Text size="xs" c="orange">
                            sin WhatsApp cargado
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{fmtDate(l.loaned_at)}</Text>
                    {!l.returned_at && (
                      <Badge size="sm" variant="light" color={l.overdue ? 'red' : l.days >= 7 ? 'orange' : 'gray'}>
                        {l.days} días
                      </Badge>
                    )}
                    {l.loaned_by_name && (
                      <Text size="xs" c="dimmed">
                        por {l.loaned_by_name}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {l.returned_at ? (
                      <>
                        <Badge color="green" variant="light">
                          Devuelto {fmtDate(l.returned_at)}
                        </Badge>
                        {l.returned_by_name && (
                          <Text size="xs" c="dimmed">
                            recibió {l.returned_by_name}
                          </Text>
                        )}
                      </>
                    ) : l.due_date ? (
                      <Text size="sm" c={l.overdue ? 'red' : undefined} fw={l.overdue ? 600 : undefined}>
                        {fmtDate(l.due_date)} {l.overdue && '(vencido)'}
                      </Text>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {l.reminders_paused ? (
                      <Badge color="gray" variant="outline" size="sm">
                        Pausados
                      </Badge>
                    ) : (
                      !l.returned_at && l.remind_today && (
                        <Badge color="orange" variant="light" size="sm">
                          Toca hoy
                        </Badge>
                      )
                    )}
                    <Text size="xs" c="dimmed">
                      {l.reminder_count ? `${l.reminder_count} enviados · último ${fmtDate(l.last_reminder_at)}` : 'Ninguno'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {!l.returned_at && write && (
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label={l.remind_to ? `Mandar recordatorio a ${remindTarget(l)}` : 'Sin responsable con WhatsApp ni número interno'}>
                          <ActionIcon variant="light" color="green" onClick={() => setRemind(l)} disabled={!l.remind_to}>
                            <IconBrandWhatsapp size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Registrar devolución">
                          <ActionIcon variant="light" onClick={() => setRet(l)}>
                            <IconArrowBackUp size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Menu>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray">
                              <IconDots size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEdit(l)}>
                              Editar / quién lo prestó / pausar
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {filtered.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="lg">
                      {status === 'active' ? 'No hay nada prestado 🎉' : 'Sin préstamos'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <LoanFormModal opened={newOpen} onClose={() => setNewOpen(false)} />
      <RemindModal loan={remind} onClose={() => setRemind(null)} />
      <ReturnModal loan={ret} onClose={() => setRet(null)} />
      <EditLoanModal loan={edit} onClose={() => setEdit(null)} />
      <NotifyModal kind={notify} onClose={() => setNotify(null)} />
    </Stack>
  );
}
