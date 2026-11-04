import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Button, Group, Loader, Text } from '@mantine/core';
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react';
import { useItems } from '../api';

export default function Labels() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = new Set((params.get('ids') ?? '').split(',').filter(Boolean).map(Number));
  const { data: items = [], isLoading } = useItems(true);
  const list = items.filter((i) => ids.has(i.id));
  const [qrs, setQrs] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      list.map(async (i) => [i.id, await QRCode.toDataURL(`${window.location.origin}/items/${i.id}`, { margin: 0, width: 200 })] as const),
    ).then((pairs) => !cancelled && setQrs(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((i) => i.id).join(',')]);

  if (isLoading) return <Loader m="xl" />;
  return (
    <div style={{ padding: 16, background: '#fff', minHeight: '100vh' }}>
      <Group className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate(-1)}>
          Volver
        </Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
          Imprimir {list.length} etiquetas
        </Button>
        <Text size="sm" c="dimmed">
          Al escanear el QR con el celular se abre la ficha del ítem.
        </Text>
      </Group>
      <div className="labels-grid">
        {list.map((i) => (
          <div className="label" key={i.id}>
            {qrs[i.id] ? <img src={qrs[i.id]} alt="" /> : <div style={{ width: '26mm' }} />}
            <div style={{ minWidth: 0 }}>
              <div className="code">{i.code}</div>
              <div className="desc">{i.description}</div>
              {i.serial_number && <div className="sn">S/N {i.serial_number}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
