import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, Stack, Table, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBrandWhatsapp, IconEdit, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { api, canWrite, type Contact, isAdmin, useContacts, useMe, useRefresh } from '../api';
import { fmtPhone, norm, notifyError, notifyOk } from '../util';

function ContactModal({ contact, opened, onClose }: { contact: Contact | null; opened: boolean; onClose: () => void }) {
  const refresh = useRefresh();
  const [v, setV] = useState({ name: '', company: '', phone: '', email: '', notes: '' });
  const [lastKey, setLastKey] = useState('');
  const key = `${opened}-${contact?.id}`;
  if (key !== lastKey) {
    setLastKey(key);
    setV({
      name: contact?.name ?? '',
      company: contact?.company ?? '',
      phone: contact?.phone ? fmtPhone(contact.phone) : '',
      email: contact?.email ?? '',
      notes: contact?.notes ?? '',
    });
  }

  const save = async () => {
    try {
      if (contact) await api(`/api/contacts/${contact.id}`, { method: 'PUT', body: v });
      else await api('/api/contacts', { body: v });
      notifyOk('Empresa guardada');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={contact ? 'Editar empresa' : 'Nueva empresa'}>
      <Stack>
        <TextInput label="Empresa" placeholder="Edenor" required data-autofocus value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <TextInput label="Persona de contacto (opcional)" value={v.company} onChange={(e) => setV({ ...v, company: e.currentTarget.value })} />
        <TextInput
          label="Teléfono (opcional)"
          description="Solo como dato de contacto; los recordatorios van al responsable del préstamo"
          value={v.phone}
          onChange={(e) => setV({ ...v, phone: e.currentTarget.value })}
        />
        <TextInput label="Email" value={v.email} onChange={(e) => setV({ ...v, email: e.currentTarget.value })} />
        <Textarea label="Notas" value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button onClick={save} disabled={!v.name.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function Contacts() {
  const { data: contacts = [] } = useContacts();
  const { data: me } = useMe();
  const refresh = useRefresh();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ contact: Contact | null } | null>(null);

  const filtered = useMemo(() => {
    const t = norm(q);
    return t ? contacts.filter((c) => norm([c.name, c.company, c.phone, c.email].join(' ')).includes(t)) : contacts;
  }, [contacts, q]);

  const remove = (c: Contact) =>
    modals.openConfirmModal({
      title: `Borrar ${c.name}`,
      labels: { confirm: 'Borrar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api(`/api/contacts/${c.id}`, { method: 'DELETE' });
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Empresas</Title>
        {canWrite(me?.user) && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEdit({ contact: null })}>
            Nueva empresa
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        Clientes y empresas a las que Silk les presta equipos. Quién de Silk prestó cada cosa se ve en Préstamos.
      </Text>
      <TextInput placeholder="Buscar" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} maw={360} />
      <Table.ScrollContainer minWidth={700}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Contacto</Table.Th>
              <Table.Th>Teléfono</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Préstamos</Table.Th>
              <Table.Th w={80} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.company}</Table.Td>
                <Table.Td>
                  {c.phone ? fmtPhone(c.phone) : ''}
                </Table.Td>
                <Table.Td>{c.email}</Table.Td>
                <Table.Td>
                  {c.active_loans > 0 && (
                    <Badge color="orange" variant="light" mr={4}>
                      {c.active_loans} activos
                    </Badge>
                  )}
                  <Text span size="xs" c="dimmed">
                    {c.total_loans} en total
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {canWrite(me?.user) && (
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" onClick={() => setEdit({ contact: c })}>
                          <IconEdit size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {isAdmin(me?.user) && c.total_loans === 0 && (
                      <ActionIcon variant="subtle" color="red" onClick={() => remove(c)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <ContactModal opened={!!edit} contact={edit?.contact ?? null} onClose={() => setEdit(null)} />
    </Stack>
  );
}
