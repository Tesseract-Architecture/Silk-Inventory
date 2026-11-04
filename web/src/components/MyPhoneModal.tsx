import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { api, type User } from '../api';
import { fmtPhone, notifyError, notifyOk } from '../util';

/** El WhatsApp propio: ahí llegan los recordatorios de los préstamos que uno tiene a cargo. */
export default function MyPhoneModal({ user, opened, onClose }: { user: User; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [lastOpened, setLastOpened] = useState(false);
  if (opened !== lastOpened) {
    setLastOpened(opened);
    if (opened) setPhone(user.phone ? fmtPhone(user.phone) : '');
  }

  const save = async () => {
    try {
      await api('/api/me', { method: 'PUT', body: { phone } });
      notifyOk(phone ? 'WhatsApp guardado' : 'WhatsApp borrado');
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['users-list'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Mi WhatsApp">
      <Stack>
        <Text size="sm" c="dimmed">
          Acá te llegan los recordatorios de los préstamos que tenés a cargo, para que los reclames.
        </Text>
        <TextInput
          label="Tu número de WhatsApp"
          placeholder="11 1234-5678"
          data-autofocus
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <Group justify="flex-end">
          <Button onClick={save}>Guardar</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
