import { useState } from 'react';
import { Navigate, NavLink as RouterLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon, Alert, Anchor, AppShell, Avatar, Burger, Center, Divider, Group, Indicator, Loader, Menu, NavLink, Text, TextInput,
  useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle, IconBox, IconBrandWhatsapp, IconBuilding, IconUsers, IconHandGrab, IconHistory, IconLayoutDashboard, IconLogout, IconMapPin,
  IconMoon, IconPlugConnected, IconRefresh, IconSearch, IconSettings, IconSun,
} from '@tabler/icons-react';
import { api, isAdmin, useMe } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import ItemDetail from './pages/ItemDetail';
import Locations from './pages/Locations';
import Loans from './pages/Loans';
import Contacts from './pages/Contacts';
import Activity from './pages/Activity';
import Admin from './pages/Admin';
import Labels from './pages/Labels';
import Stock from './pages/Stock';
import Team from './pages/Team';
import Sfps from './pages/Sfps';
import MyPhoneModal from './components/MyPhoneModal';
import SilkLogo from './components/SilkLogo';
import { useVersion } from './components/UpdatesTab';
import { fmtPhone } from './util';

const NAV = [
  { to: '/', label: 'Inicio', icon: IconLayoutDashboard },
  { to: '/inventario', label: 'Inventario', icon: IconBox },
  { to: '/ubicaciones', label: 'Ubicaciones', icon: IconMapPin },
  { to: '/prestamos', label: 'Préstamos', icon: IconHandGrab },
  { to: '/sfps', label: 'SFPs', icon: IconPlugConnected },
  { to: '/stock', label: 'Stock mínimo', icon: IconAlertTriangle },
  { to: '/empresas', label: 'Empresas', icon: IconBuilding },
  { to: '/equipo', label: 'Equipo', icon: IconUsers },
  { to: '/actividad', label: 'Actividad', icon: IconHistory },
];

export default function App() {
  const { pathname } = useLocation();
  const me = useMe();

  if (pathname === '/login') return <Login />;
  if (me.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (pathname === '/etiquetas') return <Labels />;
  return <Shell />;
}

/** Aviso arriba de todo cuando WhatsApp no está conectado (no salen los recordatorios). */
/** Solo admins: aviso cuando en GitHub hay una versión más nueva que la que corre. */
function UpdateBanner() {
  const { data } = useVersion();
  if (!data?.pending?.length) return null;
  return (
    <Alert color="blue" icon={<IconRefresh />} mb="md" className="no-print" title="Hay una versión nueva de la app">
      {data.pending.length} {data.pending.length === 1 ? 'cambio' : 'cambios'} sin instalar.{' '}
      <Anchor component={RouterLink} to="/admin?tab=updates" inherit fw={600}>
        Ver cómo actualizar
      </Anchor>
    </Alert>
  );
}

function WhatsAppBanner({ admin }: { admin: boolean }) {
  const { data } = useQuery({
    queryKey: ['wa-status'],
    queryFn: () => api<{ status: string; lastError: string | null }>('/api/whatsapp/status'),
    refetchInterval: 60_000,
  });
  if (!data || data.status === 'conectado' || data.status === 'deshabilitado') return null;
  return (
    <Alert color="orange" icon={<IconBrandWhatsapp />} mb="md" className="no-print" title="WhatsApp desconectado: no se están mandando los recordatorios">
      {data.lastError ?? 'Hay que vincular el celular de la empresa escaneando el QR.'}{' '}
      {admin ? (
        <Anchor component={RouterLink} to="/admin" inherit fw={600}>
          Ir a vincular
        </Anchor>
      ) : (
        'Avisale a un administrador.'
      )}
    </Alert>
  );
}

function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data } = useMe();
  const user = data!.user!;
  const [search, setSearch] = useState('');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');

  const logout = async () => {
    const r = await api<{ redirect: string }>('/api/auth/logout', { method: 'POST' });
    window.location.href = r.redirect;
  };

  const nav = isAdmin(user) ? [...NAV, { to: '/admin', label: 'Administración', icon: IconSettings }] : NAV;

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 170, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" pr="md" justify="space-between" wrap="nowrap">
          <Group gap={0} wrap="nowrap" h="100%">
            {/* Mismo ancho que el menú lateral: el borde de la derecha sigue la línea del menú. */}
            <Group gap="sm" wrap="nowrap" h="100%" px="md" className="header-brand">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <SilkLogo height={40} />
            </Group>
            <Text fw={600} visibleFrom="xs" px="md">
              Inventario
            </Text>
          </Group>
          <form
            style={{ flex: 1, maxWidth: 420 }}
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/inventario?q=${encodeURIComponent(search)}`);
              setSearch('');
            }}
          >
            <TextInput
              placeholder="Buscar por descripción, serie, código…"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </form>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
              aria-label="Cambiar tema"
            >
              {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
            <Menu position="bottom-end">
              <Menu.Target>
                <Indicator color="orange" size={10} offset={4} disabled={!!user.phone} withBorder>
                  <Avatar radius="xl" color="indigo" style={{ cursor: 'pointer' }}>
                    {user.name.slice(0, 2).toUpperCase()}
                  </Avatar>
                </Indicator>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {user.name}
                  <br />
                  {user.email} · {user.role}
                </Menu.Label>
                <Menu.Item
                  leftSection={<IconBrandWhatsapp size={16} />}
                  onClick={() => setPhoneOpen(true)}
                  color={user.phone ? undefined : 'orange'}
                >
                  {user.phone ? `Mi WhatsApp: ${fmtPhone(user.phone)}` : 'Cargá tu WhatsApp'}
                </Menu.Item>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>
                  Cerrar sesión
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            component={RouterLink}
            to={n.to}
            label={n.label}
            leftSection={<n.icon size={17} />}
            active={n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)}
            onClick={close}
            py={6}
            px={8}
            style={{ borderRadius: 8 }}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <WhatsAppBanner admin={isAdmin(user)} />
        {isAdmin(user) && <UpdateBanner />}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventario" element={<Inventory />} />
          <Route path="/items/:id" element={<ItemDetail />} />
          <Route path="/ubicaciones" element={<Locations />} />
          <Route path="/ubicaciones/:id" element={<Locations />} />
          <Route path="/prestamos" element={<Loans />} />
          <Route path="/sfps" element={<Sfps />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/empresas" element={<Contacts />} />
          <Route path="/contactos" element={<Navigate to="/empresas" replace />} />
          <Route path="/equipo" element={<Team />} />
          <Route path="/actividad" element={<Activity />} />
          <Route path="/admin" element={isAdmin(user) ? <Admin /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AppShell.Main>
      <MyPhoneModal user={user} opened={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </AppShell>
  );
}
