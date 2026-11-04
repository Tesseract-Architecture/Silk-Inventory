// Previsualiza y manda por WhatsApp: a cada responsable lo suyo, el resumen de préstamos o la alerta de stock.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { api, useRefresh } from '../api';
import { fmtPhone, notifyError, notifyOk } from '../util';

export type NotifyKind = 'responsibles' | 'loans' | 'stock';

interface Preview {
  responsibles: { to: string; name: string | null; count: number; text: string }[];
  withoutTarget: string[];
  loansSummary: { to: string; text: string | null };
  stock: { to: string; text: string | null };
}

const TITLES: Record<NotifyKind, string> = {
  responsibles: 'Mandarle a cada responsable lo suyo',
  loans: 'Mandar resumen de todo lo prestado',
  stock: 'Mandar alerta de stock mínimo',
};

const ENDPOINT: Record<NotifyKind, string> = {
  responsibles: '/api/notify/responsibles',
  loans: '/api/notify/loans-summary',
  stock: '/api/notify/stock',
};

function dest(to: string) {
  if (!to) return null;
  return to.includes('@g.us') ? 'grupo de WhatsApp' : to.includes('@') ? to : fmtPhone(to);
}

function Message({ text }: { text: string }) {
  return (
    <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
        {text}
      </Text>
    </Card>
  );
}

export default function NotifyModal({ kind, onClose }: { kind: NotifyKind | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [sending, setSending] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['notify-preview', kind],
    queryFn: () => api<Preview>('/api/notify/preview'),
    enabled: !!kind,
  });

  const send = async () => {
    setSending(true);
    try {
      const r = await api<{ sent?: number; errors?: number; skipped?: number; errorMessages?: string[] }>(ENDPOINT[kind!], {
        method: 'POST',
        body: {},
      });
      if (kind === 'responsibles') {
        notifyOk(`Enviados: ${r.sent ?? 0}${r.errors ? ` · con error: ${r.errors}` : ''}${r.skipped ? ` · sin destino: ${r.skipped}` : ''}`);
        if (r.errorMessages?.length) notifyError(new Error(r.errorMessages.join(' · ')));
      } else notifyOk('Mensaje enviado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSending(false);
    }
  };

  let body: React.ReactNode = null;
  let canSend = false;
  if (data && kind === 'responsibles') {
    canSend = data.responsibles.length > 0;
    body = (
      <Stack gap="sm">
        {data.responsibles.length === 0 && <Text c="dimmed">No hay préstamos activos con a quién avisar.</Text>}
        {data.responsibles.map((r) => (
          <div key={r.to}>
            <Text size="sm" fw={600} mb={4}>
              Para {r.name ?? 'número/grupo interno'} · {dest(r.to)} ({r.count} {r.count === 1 ? 'préstamo' : 'préstamos'})
            </Text>
            <Message text={r.text} />
          </div>
        ))}
        {data.withoutTarget.length > 0 && (
          <Alert color="yellow" title={`${data.withoutTarget.length} préstamos sin a quién avisar`}>
            No tienen responsable con WhatsApp y no hay número/grupo interno configurado (Administración → Avisos):{' '}
            {data.withoutTarget.join(' · ')}
          </Alert>
        )}
      </Stack>
    );
  } else if (data) {
    const part = kind === 'loans' ? data.loansSummary : data.stock;
    canSend = !!part.to;
    body = (
      <Stack gap="sm">
        <Text size="sm" fw={600}>
          Para: {dest(part.to) ?? 'no hay destino configurado'}
        </Text>
        {!part.to && <Alert color="yellow">Configurá el número o grupo interno en Administración → Avisos.</Alert>}
        <Message text={part.text ?? (kind === 'loans' ? '✅ No hay nada prestado.' : '✅ Todo el stock está por encima del mínimo.')} />
      </Stack>
    );
  }

  return (
    <Modal opened={!!kind} onClose={onClose} title={kind ? TITLES[kind] : ''} size="lg">
      {isLoading || !data ? (
        <Loader />
      ) : (
        <Stack>
          <ScrollArea.Autosize mah="60vh">{body}</ScrollArea.Autosize>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button color="green" leftSection={<IconBrandWhatsapp size={16} />} onClick={send} loading={sending} disabled={!canSend}>
              Mandar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
