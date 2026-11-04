// Equipo de Silk: los usuarios de la app. Acá se cargan con su WhatsApp (ahí les llegan los
// recordatorios de los préstamos que hicieron) aunque todavía no hayan entrado nunca.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon, Badge, Button, Card, Group, Modal, Select, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBrandWhatsapp, IconPlus, IconTrash, IconUsersPlus } from '@tabler/icons-react';
import { api, isAdmin, type Role, useMe } from '../api';
import { fmtDateTime, fmtPhone, notifyError, notifyOk } from '../util';

interface Person {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  last_login: string | null;
  active_loans: number;
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'usuario', label: 'Usuario' },
  { value: 'lectura', label: 'Solo lectura' },
];

/** Igual que en el server: "Julio Pérez" -> "julio.perez@dominio". */
function emailFromName(name: string, domain: string) {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  return `${words.length === 1 ? words[0] : `${words[0]}.${words[words.length - 1]}`}@${domain}`;
}

/** Campo que guarda al salir (o con Enter) solo si cambió. */
function InlineEdit({ value, placeholder, onSave, disabled, mono }: { value: string; placeholder?: string; onSave: (v: string) => void; disabled?: boolean; mono?: boolean }) {
  return (
    <TextInput
      size="xs"
      variant="filled"
      placeholder={placeholder}
      defaultValue={value}
      key={value}
      disabled={disabled}
      classNames={mono ? { input: 'mono' } : undefined}
      onBlur={(e) => e.currentTarget.value.trim() !== value && onSave(e.currentTarget.value.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export default function Team() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user);
  const { data } = useQuery({ queryKey: ['team'], queryFn: () => api<{ domain: string; people: Person[] }>('/api/team') });
  const people = data?.people ?? [];
  const domain = data?.domain ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const suggested = emailFromName(name, domain);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const addBulk = async () => {
    try {
      const r = await api<{ added: string[]; existing: string[]; rejected: string[] }>('/api/team/bulk', { body: { text: bulkText } });
      notifyOk(`Agregados: ${r.added.length}${r.existing.length ? ` · ya estaban: ${r.existing.length}` : ''}`);
      if (r.rejected.length) notifyError(new Error(`No son del dominio de la empresa: ${r.rejected.join(', ')}`));
      setBulkText('');
      setBulkOpen(false);
      reload();
    } catch (e) {
      notifyError(e);
    }
  };

  const reload = () => {
    for (const k of ['team', 'me', 'users-list', 'loans']) qc.invalidateQueries({ queryKey: [k] });
  };

  const add = async () => {
    try {
      await api('/api/team', { body: { name, email: emailTouched ? email : suggested, phone } });
      notifyOk(`${name} agregado`);
      setName('');
      setEmail('');
      setEmailTouched(false);
      setPhone('');
      reload();
    } catch (e) {
      notifyError(e);
    }
  };

  const update = (id: number, body: Partial<Person>) =>
    api(`/api/team/${id}`, { method: 'PUT', body }).then(() => {
      notifyOk('Guardado');
      reload();
    }, notifyError);

  const remove = (p: Person) =>
    modals.openConfirmModal({
      title: `Quitar a ${p.name}`,
      labels: { confirm: 'Quitar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        api(`/api/team/${p.id}`, { method: 'DELETE' }).then(() => {
          notifyOk(`${p.name} quitado`);
          reload();
        }, notifyError),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Equipo</Title>
        {admin && (
          <Button variant="default" leftSection={<IconUsersPlus size={16} />} onClick={() => setBulkOpen(true)}>
            Agregar varios
          </Button>
        )}
      </Group>
      <Modal opened={bulkOpen} onClose={() => setBulkOpen(false)} title="Agregar varios" size="lg">
        <Stack>
          <Text size="sm" c="dimmed">
            Pegá los mails (separados por espacios, comas o uno por renglón). El nombre sale del mail y se corrige solo cuando cada uno entra
            con Microsoft. Los que ya están no se duplican.
          </Text>
          <Textarea
            autosize
            minRows={5}
            data-autofocus
            placeholder="julio.rosal@silk-technologies.com paula.moroni@silk-technologies.com …"
            value={bulkText}
            onChange={(e) => setBulkText(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button onClick={addBulk} disabled={!bulkText.includes('@')}>
              Agregar
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Text size="sm" c="dimmed">
        La gente de Silk. Cuando alguien presta algo, el recordatorio para reclamarlo le llega a su WhatsApp. Cada uno entra con su cuenta de
        Microsoft ({domain ? `@${domain}` : 'mail de la empresa'}) y queda vinculado por el mail.
      </Text>

      {admin && (
        <Card withBorder>
          <Text fw={600} size="sm" mb="xs">
            Agregar persona
          </Text>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput label="Nombre y apellido" placeholder="Julio Pérez" value={name} onChange={(e) => setName(e.currentTarget.value)} w={220} />
            <TextInput
              label="Mail"
              value={emailTouched ? email : suggested}
              onChange={(e) => {
                setEmailTouched(true);
                setEmail(e.currentTarget.value);
              }}
              w={300}
              classNames={{ input: 'mono' }}
            />
            <TextInput
              label="WhatsApp"
              placeholder="11 1234-5678"
              leftSection={<IconBrandWhatsapp size={16} />}
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()}
              w={190}
            />
            <Button leftSection={<IconPlus size={16} />} onClick={add} disabled={!name.trim()}>
              Agregar
            </Button>
          </Group>
        </Card>
      )}

      <Table.ScrollContainer minWidth={820}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nombre</Table.Th>
              <Table.Th>Mail</Table.Th>
              <Table.Th w={190}>WhatsApp</Table.Th>
              <Table.Th w={110}>Préstamos a cargo</Table.Th>
              <Table.Th w={160}>Rol</Table.Th>
              <Table.Th>Último ingreso</Table.Th>
              {admin && <Table.Th w={40} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {people.map((p) => {
              const self = p.id === me?.user?.id;
              return (
                <Table.Tr key={p.id}>
                  <Table.Td>{admin ? <InlineEdit value={p.name} onSave={(v) => update(p.id, { name: v })} /> : p.name}</Table.Td>
                  <Table.Td>
                    {admin ? <InlineEdit value={p.email} mono onSave={(v) => update(p.id, { email: v })} /> : <Text size="sm">{p.email}</Text>}
                  </Table.Td>
                  <Table.Td>
                    {admin || self ? (
                      <InlineEdit value={p.phone ? fmtPhone(p.phone) : ''} placeholder="Sin cargar" onSave={(v) => update(p.id, { phone: v })} />
                    ) : p.phone ? (
                      fmtPhone(p.phone)
                    ) : (
                      <Text size="sm" c="dimmed">
                        Sin cargar
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {p.active_loans > 0 ? (
                      <Badge variant="light" color="orange">
                        {p.active_loans}
                      </Badge>
                    ) : (
                      <Text size="sm" c="dimmed">
                        0
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {admin ? (
                      <Select
                        size="xs"
                        variant="filled"
                        allowDeselect={false}
                        disabled={self}
                        data={ROLE_OPTIONS}
                        value={p.role}
                        onChange={(role) => role && update(p.id, { role: role as Role })}
                      />
                    ) : (
                      ROLE_OPTIONS.find((r) => r.value === p.role)?.label
                    )}
                  </Table.Td>
                  <Table.Td>
                    {p.last_login ? (
                      <Text size="sm">{fmtDateTime(p.last_login)}</Text>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Todavía no entró
                      </Text>
                    )}
                  </Table.Td>
                  {admin && (
                    <Table.Td>
                      {!p.last_login && !self && (
                        <Tooltip label="Quitar">
                          <ActionIcon variant="subtle" color="red" onClick={() => remove(p)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
