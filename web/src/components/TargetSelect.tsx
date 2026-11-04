// A quién mandar un aviso: una persona de Equipo ("user:12", usa su WhatsApp) o un grupo de WhatsApp.
import { useQuery } from '@tanstack/react-query';
import { Select } from '@mantine/core';
import { api, useUsers } from '../api';
import { fmtPhone } from '../util';

export function useWaGroups() {
  return useQuery({ queryKey: ['wa-groups'], queryFn: () => api<{ id: string; name: string }[]>('/api/notify/groups') });
}

export default function TargetSelect({
  label, value, onChange, placeholder, description, clearable = true, w,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  description?: string;
  clearable?: boolean;
  w?: number | string;
}) {
  const { data: users = [] } = useUsers();
  const { data: groups = [] } = useWaGroups();

  type Option = { value: string; label: string; disabled?: boolean };
  const data: { group: string; items: Option[] }[] = [
    {
      group: 'Personas',
      items: users.map((u) => ({
        value: `user:${u.id}`,
        label: u.has_phone ? u.name : `${u.name} (sin WhatsApp cargado)`,
        disabled: !u.has_phone,
      })),
    },
    { group: 'Grupos de WhatsApp', items: groups.map((g) => ({ value: g.id, label: g.name })) },
  ].filter((g) => g.items.length);

  // Destinos viejos o que ya no aparecen (número suelto, grupo del que salió el celular).
  if (value && !data.some((g) => g.items.some((i) => i.value === value))) {
    const other = value.includes('@g.us') ? 'Grupo de WhatsApp (no disponible)' : /^\d+$/.test(value) ? fmtPhone(value) : value;
    data.push({ group: 'Otro', items: [{ value, label: other }] });
  }

  return (
    <Select
      label={label}
      description={description}
      placeholder={placeholder ?? 'Elegí una persona o un grupo'}
      searchable
      clearable={clearable}
      allowDeselect={clearable}
      nothingFoundMessage="No hay coincidencias"
      data={data}
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      w={w}
      maw="100%"
    />
  );
}
