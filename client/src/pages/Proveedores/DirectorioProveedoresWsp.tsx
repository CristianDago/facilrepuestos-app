import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { proveedoresService } from '../../services/proveedores';
import { useAppStore } from '../../store/useAppStore';
import type { Proveedor } from '../../types';
import { MARCAS_VEHICULOS } from '../../types';

const RUBROS_ESPECIALIDAD = [
  'General / Multimarca',
  'Motor y Culatas',
  'Frenos y Embragues',
  'Suspensión y Dirección',
  'Transmisión y Cajas',
  'Carrocería, Ópticos y Espejos',
  'Sistema Eléctrico y Sensores',
  'Refrigeración y Climatización',
  'Mantenimiento Rápido y Filtros',
  'Vehículos Chinos (JAC, Chery, MG, Great Wall, Haval)',
  'Camionetas y Comerciales (Hilux, L200, Porter, Maxus)',
];

interface FormTiendaWsp {
  nombre: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  rut: string;
  categoria: string;
  marcasVehiculo: string[];
  marcaExtraInput: string;
  margenComercialPct: number;
  notas: string;
  activo: boolean;
}

const emptyForm = (): FormTiendaWsp => ({
  nombre: '',
  contacto: '',
  telefono: '+569',
  email: '',
  direccion: '',
  rut: '',
  categoria: 'General / Multimarca',
  marcasVehiculo: [],
  marcaExtraInput: '',
  margenComercialPct: 30,
  notas: '',
  activo: true,
});

export default function DirectorioProveedoresWsp() {
  const { notify, setLoading } = useAppStore();
  const navigate = useNavigate();

  const [proveedoresAll, setProveedoresAll] = useState<Proveedor[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroMarca, setFiltroMarca] = useState('');
  const [filtroRubro, setFiltroRubro] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormTiendaWsp>(emptyForm());
  const [guardando, setGuardando] = useState(false);

  const cargarProveedores = async () => {
    setLoading(true);
    try {
      const r = await proveedoresService.getAll();
      if (r.success && r.data) {
        setProveedoresAll(r.data);
      }
    } catch {
      notify('Error al cargar el directorio de proveedores WhatsApp', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarProveedores();
  }, []);

  // Filtrar las tiendas/proveedores que pertenecen al directorio externo / Mesa WSP
  // (excluyendo los nodos Ailoo automatizados y los que ya tienen tenant ERP con usuario propio,
  // a menos que también estén habilitados para WhatsApp o sean parte del directorio de tiendas sin ERP)
  const tiendasWsp = useMemo(() => {
    return proveedoresAll.filter((p) => {
      if (p.tipoIntegracion === 'nodo_ailoo' || Boolean(p.nodoAilooId)) return false;
      if (
        p.tipoIntegracion === 'conexion_api_erp' ||
        p.tipoIntegracion === 'scraping_portal_b2b'
      ) {
        return false;
      }
      // Si tiene usuario ERP creado y no fue marcado como cotizacion_whatsapp, vive en Proveedores & Ailoo
      if (p.uid && p.tipoIntegracion !== 'cotizacion_whatsapp') {
        return false;
      }
      return true;
    });
  }, [proveedoresAll]);

  // Todas las marcas trabajadas en el directorio para filtro rápido
  const marcasPresentes = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of tiendasWsp) {
      const listaMarcas = p.marcasVehiculo?.length ? p.marcasVehiculo : p.marcas || [];
      for (const m of listaMarcas) {
        const clean = m.trim().toUpperCase();
        if (!clean) continue;
        map.set(clean, (map.get(clean) || 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tiendasWsp]);

  const tiendasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return tiendasWsp.filter((p) => {
      const listaMarcas = p.marcasVehiculo?.length ? p.marcasVehiculo : p.marcas || [];
      const matchQ =
        !q ||
        (p.nombre || '').toLowerCase().includes(q) ||
        (p.contacto || '').toLowerCase().includes(q) ||
        (p.telefono || '').toLowerCase().includes(q) ||
        (p.direccion || '').toLowerCase().includes(q) ||
        (p.categoria || '').toLowerCase().includes(q) ||
        (p.notas || '').toLowerCase().includes(q) ||
        listaMarcas.some((m) => m.toLowerCase().includes(q));

      const matchMarca =
        !filtroMarca ||
        listaMarcas.some((m) => m.toUpperCase() === filtroMarca);

      const matchRubro =
        !filtroRubro ||
        (p.categoria || '').toLowerCase() === filtroRubro.toLowerCase();

      return matchQ && matchMarca && matchRubro;
    });
  }, [tiendasWsp, busqueda, filtroMarca, filtroRubro]);

  const abrirNuevo = () => {
    setEditandoId(null);
    setForm(emptyForm());
    setModalAbierto(true);
  };

  const abrirEditar = (p: Proveedor) => {
    const listaMarcas = p.marcasVehiculo?.length ? p.marcasVehiculo : p.marcas || [];
    setEditandoId(p.id || null);
    setForm({
      nombre: p.nombre || '',
      contacto: p.contacto || '',
      telefono: p.telefono || '+569',
      email: p.email || '',
      direccion: p.direccion || '',
      rut: p.rut || '',
      categoria: p.categoria || 'General / Multimarca',
      marcasVehiculo: [...listaMarcas],
      marcaExtraInput: '',
      margenComercialPct: Number(p.margenPct) || 30,
      notas: p.notas || '',
      activo: p.canalWspActivo !== false,
    });
    setModalAbierto(true);
  };

  const toggleMarcaEnForm = (marca: string) => {
    const m = marca.trim().toUpperCase();
    setForm((prev) => {
      const existe = prev.marcasVehiculo.includes(m);
      return {
        ...prev,
        marcasVehiculo: existe
          ? prev.marcasVehiculo.filter((x) => x !== m)
          : [...prev.marcasVehiculo, m],
      };
    });
  };

  const agregarMarcaPersonalizada = () => {
    const nuevas = form.marcaExtraInput
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (nuevas.length === 0) return;
    setForm((prev) => ({
      ...prev,
      marcasVehiculo: [...new Set([...prev.marcasVehiculo, ...nuevas])],
      marcaExtraInput: '',
    }));
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      notify('Ingresa el nombre de la tienda o proveedor', 'error');
      return;
    }
    if (!form.telefono.trim()) {
      notify('Ingresa el número de WhatsApp o teléfono de contacto', 'error');
      return;
    }
    setGuardando(true);
    try {
      const payload: Omit<Proveedor, 'id'> = {
        nombre: form.nombre.trim(),
        contacto: form.contacto.trim(),
        telefono: form.telefono.trim(),
        email: form.email.trim(),
        direccion: form.direccion.trim(),
        rut: form.rut.trim(),
        categoria: form.categoria.trim() || 'General / Multimarca',
        marcas: form.marcasVehiculo,
        marcasVehiculo: form.marcasVehiculo,
        margenPct: Number(form.margenComercialPct) || 30,
        notas: form.notas.trim(),
        canalWspActivo: form.activo,
        tipoIntegracion: 'cotizacion_whatsapp',
      };

      if (editandoId) {
        await proveedoresService.update(editandoId, payload);
        notify(`Ficha de "${payload.nombre}" actualizada ✓`, 'success');
      } else {
        await proveedoresService.create(payload);
        notify(`Tienda "${payload.nombre}" registrada en el Portal Proveedor WSP ✓`, 'success');
      }
      setModalAbierto(false);
      await cargarProveedores();
    } catch (err) {
      notify((err as Error)?.message || 'Error al guardar proveedor', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const handleToggleActivo = async (p: Proveedor) => {
    if (!p.id) return;
    try {
      const nuevoEstado = p.canalWspActivo === false;
      await proveedoresService.update(p.id, {
        ...p,
        canalWspActivo: nuevoEstado,
      });
      notify(
        nuevoEstado
          ? `✓ "${p.nombre}" activado para consultas en Mesa WSP`
          : `"${p.nombre}" pausado en Mesa WSP`,
        'info'
      );
      await cargarProveedores();
    } catch {
      notify('Error al actualizar estado del proveedor', 'error');
    }
  };

  const handleEliminar = async (p: Proveedor) => {
    if (!p.id) return;
    if (!confirm(`¿Eliminar a "${p.nombre}" del directorio de proveedores WhatsApp?`)) return;
    try {
      await proveedoresService.delete(p.id);
      notify(`Proveedor "${p.nombre}" eliminado`, 'info');
      await cargarProveedores();
    } catch {
      notify('Error al eliminar proveedor', 'error');
    }
  };

  const marcasCatalogoBase = useMemo(() => {
    const base = MARCAS_VEHICULOS.filter((m) => m !== 'OTRO');
    const extras = ['MAXUS', 'FOTON', 'SSANGYONG', 'CHANGLIN', 'DFSK', 'CHANGAN', 'OPEL'];
    return [...new Set([...base, ...extras])];
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ENCABEZADO DEL DIRECTORIO ("DOBLE CLIC" DE PROVEEDORES DE MESA WSP) */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 65%, #0f766e 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '22px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.14)',
        }}
      >
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                color: '#6ee7b7',
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Directorio Maestro · Mesa de Abastecimiento WSP
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
            🏪 Portal Proveedor — Directorio de Tiendas, Contactos & Marcas
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.5 }}>
            El doble clic de los proveedores de <strong>Mesa de Abastecimiento WSP</strong>. Registra y administra aquí todas las tiendas externas a las que no les entregamos ERP ni conexión API: nombres, vendedores de contacto, direcciones físicas, números de WhatsApp, especialidades y las marcas de vehículos que trabaja cada local.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-dark"
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.28)',
              color: '#ffffff',
              fontWeight: 700,
            }}
            onClick={() => navigate('/mesa-wsp')}
          >
            📲 Ir a Mesa Abastecimiento WSP
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontWeight: 800, padding: '10px 18px' }}
            onClick={abrirNuevo}
          >
            + Registrar Tienda / Proveedor WSP
          </button>
        </div>
      </div>

      {/* KPIs RÁPIDOS DEL DIRECTORIO */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '16px 18px',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
            Tiendas Registradas (Sin ERP/API)
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
            {tiendasWsp.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Locales con ficha de contacto y marcas
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '16px 18px',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
            Activos en Mesa WhatsApp
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#16a34a', marginTop: 4 }}>
            {tiendasWsp.filter((t) => t.canalWspActivo !== false).length}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Habilitados para multidifusión por marca
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '16px 18px',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
            Marcas de Vehículos Cubiertas
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#2563eb', marginTop: 4 }}>
            {marcasPresentes.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Enrutamiento automático según patente/marca
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: '16px 18px',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
            Con Dirección Física Registrada
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#0f766e', marginTop: 4 }}>
            {tiendasWsp.filter((t) => Boolean(t.direccion?.trim())).length}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Para retiro motorizado (1h 30m) o despacho
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS POR MARCA Y RUBRO */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Buscar por nombre de tienda, vendedor, dirección, teléfono WhatsApp o marca..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{
              flex: '1 1 320px',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #cbd5e1',
              fontSize: '0.9rem',
            }}
          />

          <select
            value={filtroRubro}
            onChange={(e) => setFiltroRubro(e.target.value)}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #cbd5e1',
              fontSize: '0.86rem',
              fontWeight: 600,
              background: '#f8fafc',
            }}
          >
            <option value="">🛠 Todos los rubros / especialidades</option>
            {RUBROS_ESPECIALIDAD.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {(busqueda || filtroMarca || filtroRubro) && (
            <button
              type="button"
              className="btn btn-sm btn-dark"
              onClick={() => {
                setBusqueda('');
                setFiltroMarca('');
                setFiltroRubro('');
              }}
            >
              ✕ Limpiar filtros
            </button>
          )}
        </div>

        {/* Píldoras de Marcas que trabajan las tiendas */}
        {marcasPresentes.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#475569', marginRight: 4 }}>
              🚗 Filtrar por Marca que trabajan:
            </span>
            <button
              type="button"
              onClick={() => setFiltroMarca('')}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: filtroMarca === '' ? '2px solid #0f172a' : '1px solid #cbd5e1',
                background: filtroMarca === '' ? '#0f172a' : '#f8fafc',
                color: filtroMarca === '' ? '#ffffff' : '#334155',
              }}
            >
              Todas ({tiendasWsp.length})
            </button>
            {marcasPresentes.map(([marca, count]) => {
              const activa = filtroMarca === marca;
              return (
                <button
                  key={marca}
                  type="button"
                  onClick={() => setFiltroMarca(activa ? '' : marca)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: activa ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    background: activa ? '#dbeafe' : '#ffffff',
                    color: activa ? '#1d4ed8' : '#1e293b',
                  }}
                >
                  {marca} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* LISTADO DE TIENDAS Y CONTACTOS */}
      {tiendasFiltradas.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '2px dashed #cbd5e1',
            borderRadius: 16,
            padding: '44px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🏪</div>
          <div style={{ fontSize: '1.08rem', fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
            {tiendasWsp.length === 0
              ? 'Aún no hay tiendas registradas en el Portal Proveedor WSP'
              : 'No se encontraron tiendas con esos filtros'}
          </div>
          <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: 540, margin: '0 auto 16px' }}>
            Agrega aquí las tiendas de repuestos, importadoras y mesones amigos con su nombre, contacto, dirección física, WhatsApp y las marcas que trabajan para consultarles directo desde la Mesa de Abastecimiento WSP.
          </p>
          <button type="button" className="btn btn-primary" onClick={abrirNuevo}>
            + Registrar Primera Tienda / Proveedor WSP
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: 16,
          }}
        >
          {tiendasFiltradas.map((tienda) => {
            const fonoLimpio = (tienda.telefono || '').replace(/[^\d]/g, '');
            const marcas = tienda.marcasVehiculo?.length ? tienda.marcasVehiculo : tienda.marcas || [];
            const activo = tienda.canalWspActivo !== false;

            return (
              <div
                key={tienda.id}
                style={{
                  background: '#ffffff',
                  border: activo ? '1px solid #e2e8f0' : '1px solid #fca5a5',
                  borderRadius: 16,
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 14,
                  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)',
                  opacity: activo ? 1 : 0.75,
                }}
              >
                <div>
                  {/* Cabecera de la tarjeta */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '1.06rem',
                          fontWeight: 900,
                          color: '#0f172a',
                          lineHeight: 1.25,
                        }}
                      >
                        🏪 {tienda.nombre}
                      </div>
                      <div
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: '#0f766e',
                          marginTop: 3,
                        }}
                      >
                        🛠 {tienda.categoria || 'General / Multimarca'} · Margen FRP:{' '}
                        {tienda.margenPct ?? 30}%
                      </div>
                    </div>

                    <span
                      style={{
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        background: activo ? '#dcfce7' : '#fee2e2',
                        color: activo ? '#15803d' : '#b91c1c',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {activo ? '● ACTIVO WSP' : '○ PAUSADO'}
                    </span>
                  </div>

                  {/* Datos de contacto, teléfono, dirección */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      fontSize: '0.83rem',
                      color: '#334155',
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <strong>👤 Contacto:</strong>{' '}
                      {tienda.contacto ? tienda.contacto : <span style={{ color: '#94a3b8' }}>Sin especificar</span>}
                    </div>
                    <div>
                      <strong>📱 WhatsApp / Teléfono:</strong>{' '}
                      <span style={{ fontWeight: 800, color: '#0f172a' }}>
                        {tienda.telefono || 'Sin teléfono'}
                      </span>
                    </div>
                    <div>
                      <strong>📍 Dirección / Local:</strong>{' '}
                      {tienda.direccion ? (
                        tienda.direccion
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Sin dirección registrada</span>
                      )}
                    </div>
                    {(tienda.email || tienda.rut) && (
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        {tienda.rut ? `RUT: ${tienda.rut}` : ''}{' '}
                        {tienda.rut && tienda.email ? ' · ' : ''}
                        {tienda.email ? `✉️ ${tienda.email}` : ''}
                      </div>
                    )}
                    {tienda.notas && (
                      <div
                        style={{
                          marginTop: 4,
                          paddingTop: 5,
                          borderTop: '1px dashed #cbd5e1',
                          fontSize: '0.78rem',
                          color: '#475569',
                        }}
                      >
                        📝 {tienda.notas}
                      </div>
                    )}
                  </div>

                  {/* Marcas que trabaja */}
                  <div>
                    <div
                      style={{
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                      }}
                    >
                      🚗 Marcas que trabaja ({marcas.length || 'Multimarca'}):
                    </div>
                    {marcas.length === 0 ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 9px',
                          borderRadius: 6,
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          background: '#f1f5f9',
                          color: '#475569',
                        }}
                      >
                        MULTIMARCA GENERAL (Recibe todas las marcas)
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {marcas.map((m) => (
                          <span
                            key={m}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: '0.73rem',
                              fontWeight: 800,
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                            }}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Botones de acción de la tarjeta */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    paddingTop: 10,
                    borderTop: '1px solid #f1f5f9',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => abrirEditar(tienda)}
                  >
                    ✏️ Editar Ficha
                  </button>

                  {fonoLimpio && (
                    <a
                      href={`https://wa.me/${fonoLimpio}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm"
                      style={{
                        background: '#dcfce7',
                        color: '#15803d',
                        border: '1px solid #86efac',
                        fontWeight: 800,
                        textDecoration: 'none',
                      }}
                    >
                      💬 Abrir WhatsApp
                    </a>
                  )}

                  <button
                    type="button"
                    className="btn btn-sm btn-dark"
                    onClick={() => handleToggleActivo(tienda)}
                  >
                    {activo ? '⏸ Pausar' : '▶ Activar'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleEliminar(tienda)}
                    style={{ marginLeft: 'auto' }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL CREAR / EDITAR TIENDA PROVEEDOR WSP */}
      {modalAbierto && (
        <div className="modal-overlay" onClick={() => setModalAbierto(false)}>
          <div
            className="modal"
            style={{ maxWidth: 760, width: '95%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                {editandoId
                  ? '✏️ Editar Tienda / Proveedor de Mesa WSP'
                  : '🏪 Registrar Nueva Tienda / Proveedor (Mesa Abastecimiento WSP)'}
              </div>
              <button className="modal-close" onClick={() => setModalAbierto(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardar}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Nombre de la Tienda / Proveedor *</label>
                    <input
                      className="form-input"
                      placeholder="Ej. Importadora Repuestos Corea Sur"
                      value={form.nombre}
                      onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Persona de Contacto / Vendedor Mesón</label>
                    <input
                      className="form-input"
                      placeholder="Ej. Carlos Soto (Mesón WhatsApp)"
                      value={form.contacto}
                      onChange={(e) => setForm((p) => ({ ...p, contacto: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Número WhatsApp Oficial *</label>
                    <input
                      className="form-input"
                      placeholder="+56987654321"
                      value={form.telefono}
                      onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Dirección Física / Calle / Comuna</label>
                    <input
                      className="form-input"
                      placeholder="Ej. Av. 10 de Julio 540, Santiago Centro"
                      value={form.direccion}
                      onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Especialidad / Rubro Principal</label>
                    <select
                      className="form-select"
                      value={form.categoria}
                      onChange={(e) => setForm((p) => ({ ...p, categoria: e.target.value }))}
                    >
                      {RUBROS_ESPECIALIDAD.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Margen Comercial FácilRepuestos (%)</label>
                    <input
                      type="number"
                      className="form-input"
                      min={0}
                      max={200}
                      value={form.margenComercialPct}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          margenComercialPct: Number(e.target.value) || 30,
                        }))
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">RUT Empresa (Opcional)</label>
                    <input
                      className="form-input"
                      placeholder="Ej. 76.543.210-K"
                      value={form.rut}
                      onChange={(e) => setForm((p) => ({ ...p, rut: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Correo Electrónico (Opcional)</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="ventas@tiendarepuestos.cl"
                      value={form.email}
                      onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Selección interactiva de Marcas que trabaja la tienda */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <label className="form-label" style={{ margin: 0 }}>
                      🚗 Marcas de Vehículos que trabaja ({form.marcasVehiculo.length} seleccionadas)
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-dark"
                        onClick={() => setForm((p) => ({ ...p, marcasVehiculo: [] }))}
                      >
                        Dejar Multimarca (Todas)
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                      maxHeight: 170,
                      overflowY: 'auto',
                      padding: '4px 0',
                    }}
                  >
                    {marcasCatalogoBase.map((marca) => {
                      const sel = form.marcasVehiculo.includes(marca);
                      return (
                        <button
                          key={marca}
                          type="button"
                          onClick={() => toggleMarcaEnForm(marca)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 8,
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            border: sel ? '2px solid #2563eb' : '1px solid #cbd5e1',
                            background: sel ? '#dbeafe' : '#ffffff',
                            color: sel ? '#1d4ed8' : '#334155',
                          }}
                        >
                          {sel ? '✓ ' : '+ '}
                          {marca}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input
                      className="form-input"
                      placeholder="Agregar otra marca (ej. SUBARU, BYD, GEELY)..."
                      value={form.marcaExtraInput}
                      onChange={(e) => setForm((p) => ({ ...p, marcaExtraInput: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          agregarMarcaPersonalizada();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-dark"
                      onClick={agregarMarcaPersonalizada}
                    >
                      + Marca
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Notas Operativas / Horarios / Condiciones de Retiro (1h 30m)
                  </label>
                  <input
                    className="form-input"
                    placeholder="Ej. Atiende L-V 09:00 a 18:30 · Retiro por mesón lateral · Descuento 15% pago transferencia"
                    value={form.notas}
                    onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-dark"
                  onClick={() => setModalAbierto(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={guardando}>
                  {guardando
                    ? 'Guardando...'
                    : editandoId
                    ? 'Guardar Cambios'
                    : 'Registrar Tienda en Portal WSP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
