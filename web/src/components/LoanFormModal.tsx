import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Group, Modal, MultiSelect, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { api, type Loan, useContacts, useItems, useMe, useRefresh, useUsers } from '../api';
import { notifyError, notifyOk, todayIso } from '../util';

interface Props {
  opened: boolean;
  onClose: () => void;
  itemIds?: number[];
}

export default function LoanFormModal({ opened, onClose, itemIds }: Props) {
  const { data: items = [] } = useItems();
  const { data: contacts = [] } = useContacts();
  const { data: users = [] } = useUsers();
  const { data: me } = useMe();
  const refresh = useRefresh();

  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'existente' | 'nuevo'>('existente');
  const [contactId, setContactId] = useState<string | null>(null);
  const [nc, setNc] = useState({ name: '', company: '', phone: '' });
  const [loanedAt, setLoanedAt] = useState<string | null>(todayIso());
  const [due, setDue] = useState<string | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [every, setEvery] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [responsibleId, setResponsibleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setSelected((itemIds ?? []).map(String));
    setMode(contacts.length ? 'existente' : 'nuevo');
    setContactId(null);
    setNc({ name: '', company: '', phone: '' });
    setLoanedAt(todayIso());
    setDue(null);
    setQty(1);
    setEvery('');
    setNotes('');
    setResponsibleId(me?.user ? String(me.user.id) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const options = useMemo(
    () =>
      items
        .filter((i) => i.status !== 'baja' && (i.kind === 'consumible' ? i.quantity > 0 : i.status !== 'prestado') || selected.includes(String(i.id)))
        .map((i) => ({
          value: String(i.id),
          label: `${i.code} · ${i.description}${i.serial_number ? ` · ${i.serial_number}` : ''}${i.kind === 'consumible' ? ` (hay ${i.quantity})` : ''}`,
        })),
    [items, selected],
  );
  const chosen = items.filter((i) => selected.includes(String(i.id)));
  const consumable = chosen.find((i) => i.kind === 'consumible');
  const responsible = users.find((u) => String(u.id) === responsibleId);

  const save = async () => {
    setSaving(true);
    try {
      await api<Loan[]>('/api/loans', {
        body: {
          item_ids: selected.map(Number),
          contact_id: mode === 'existente' && contactId ? Number(contactId) : null,
          new_contact: mode === 'nuevo' ? nc : null,
          loaned_at: loanedAt,
          due_date: due || null,
          quantity: consumable ? qty : null,
          notes,
          reminder_every_days: every === '' ? null : every,
          responsible_id: responsibleId ? Number(responsibleId) : null,
        },
      });
      notifyOk(selected.length > 1 ? `${selected.length} ítems prestados` : 'Préstamo registrado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Nuevo préstamo" size="lg">
      <Stack gap="sm">
        <MultiSelect
          label="¿Qué se presta?"
          placeholder="Buscá por descripción, código o serie"
          searchable
          data={options}
          value={selected}
          onChange={setSelected}
          limit={50}
          nothingFoundMessage="No hay ítems disponibles con ese texto"
        />
        {consumable && (
          <NumberInput
            label={`Cantidad de ${consumable.description}`}
            min={1}
            max={consumable.quantity}
            value={qty}
            onChange={(x) => setQty(Number(x) || 1)}
          />
        )}

        <Text fw={500} size="sm" mt="xs">
          ¿A qué empresa?
        </Text>
        <SegmentedControl
          value={mode}
          onChange={(m) => setMode(m as typeof mode)}
          data={[
            { value: 'existente', label: 'Empresa existente' },
            { value: 'nuevo', label: 'Empresa nueva' },
          ]}
        />
        {mode === 'existente' ? (
          <>
            <Select
              placeholder="Elegí la empresa"
              searchable
              data={contacts.map((c) => ({ value: String(c.id), label: c.company && c.company !== c.name ? `${c.name} (${c.company})` : c.name }))}
              value={contactId}
              onChange={setContactId}
            />
          </>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput label="Empresa" required value={nc.name} onChange={(e) => setNc({ ...nc, name: e.currentTarget.value })} />
            <TextInput label="Persona de contacto" value={nc.company} onChange={(e) => setNc({ ...nc, company: e.currentTarget.value })} />
            <TextInput
              label="Teléfono (opcional)"
              placeholder="11 1234-5678"
              value={nc.phone}
              onChange={(e) => setNc({ ...nc, phone: e.currentTarget.value })}
            />
          </SimpleGrid>
        )}

        <Select
          mt="xs"
          label="¿Quién de Silk lo presta?"
          description="Le llegan por WhatsApp los recordatorios para reclamarlo"
          searchable
          clearable
          placeholder="Sin responsable (va al número/grupo interno)"
          data={users.map((u) => ({ value: String(u.id), label: u.has_phone ? u.name : `${u.name} (sin WhatsApp cargado)` }))}
          value={responsibleId}
          onChange={setResponsibleId}
        />
        {responsible && !responsible.has_phone && (
          <Alert color="yellow" p="xs">
            {responsible.id === me?.user?.id
              ? 'No tenés tu WhatsApp cargado: tocá tu avatar (arriba a la derecha) o cargalo en Equipo.'
              : `${responsible.name} no tiene WhatsApp cargado (se carga en Equipo): mientras tanto el aviso va al número/grupo interno.`}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 3 }} mt="xs">
          <DateInput label="Fecha de préstamo" value={loanedAt} onChange={setLoanedAt} required />
          <DateInput label="Devolución prevista" placeholder="Opcional" value={due} onChange={setDue} clearable minDate={loanedAt ?? undefined} />
          <NumberInput
            label="Recordar cada (días)"
            placeholder="Por defecto"
            min={1}
            value={every}
            onChange={(x) => setEvery(x === '' ? '' : Number(x))}
          />
        </SimpleGrid>
        <Textarea label="Notas" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Text size="xs" c="dimmed">
          Si no ponés fecha de devolución, el recordatorio al responsable sale a los días configurados en Administración (por defecto 7).
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={save}
            loading={saving}
            disabled={!selected.length || !loanedAt || (mode === 'existente' ? !contactId : !nc.name.trim())}
          >
            Registrar préstamo
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
