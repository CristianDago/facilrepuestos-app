import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { proveedoresService } from '../../services/proveedores';
import { woocommerceService } from '../../services/woocommerce';
import type { Proveedor, TipoIntegracionProveedor } from '../../types';
import { formatRut } from '../../utils/validaciones';

const rutToEmail = (rut: string) => {
  const clean = (rut || '').replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return clean ? `${clean}@drmotors.internal` : 'sin-rut@drmotors.internal';
};

export default function Proveedores() {
  const navigate = useNavigate();
  const { proveedores, setProveedores, setLoading, notify } = useAppStore();

  const [filtroModo, setFiltroModo] = useState<
    'todos' | 'portal_erp_local' | 'conexion_api_erp' | 'scraping_portal_b2b' | 'nodo_ailoo'
  >('todos');
  const [busqueda, setBusqueda] = useState('');

  // Modal de Alta / Edición de Integración Técnica (Tenant ERP / API / Scraping)
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [sincronizandoAiloo, setSincronizandoAiloo] = useState(false);

  const [form, setForm] = useState({
    nombre: '',
    rut: '',
    contacto: '',
    email: '',
    telefono: '',
    direccion: '',
    tipoIntegracion: 'portal_erp_local' as TipoIntegracionProveedor,
    prefijoSku: 'FRP-TND',
    margenPct: 30,
    notas: '',
    // Configuración API
    apiTipo: 'rest_json' as 'rest_json' | 'bigquery_ailoo' | 'graphql' | 'xml_feed',
    apiEndpointUrl: '',
    apiKey: '',
    apiFrecuenciaSync: 'Cada 30 minutos (Delta)',
    // Configuración Scraping Portal B2B
    scrapingPortalUrl: '',
    scrapingUsuario: '',
    scrapingClave: '',
    scrapingModo: 'catalogo_completo' as 'catalogo_completo' | 'consulta_sku_demanda',
    scrapingSelectorPrecio: '',
    scrapingSelectorStock: '',
    // Password opcional al crear nuevo Tenant ERP en 1 paso
    passwordInicialTenant: '',
  });

  // Modal de Credenciales / Acceso Usuario Tenant ERP
  const [accesoModal, setAccesoModal] = useState(false);
  const [accesoProveedor, setAccesoProveedor] = useState<Proveedor | null>(null);
  const [accesoPassword, setAccesoPassword] = useState('');
  const [dandoAcceso, setDandoAcceso] = useState(false);

  const loadProveedores = async () => {
    setLoading(true);
    try {
      const res = await proveedoresService.getAll();
      if (res.success && res.data) {
        setProveedores(res.data);
      }
    } catch {
      notify('Error al cargar integraciones y tenants ERP', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProveedores();
  }, []);

  // Filtrar solo proveedores/tiendas de integración técnica (excluyendo los contactos puros de Mesa WSP)
  const integracionesTecnicas = useMemo(() => {
    return proveedores.filter((p) => {
      const tipo = p.tipoIntegracion || (p.uid ? 'portal_erp_local' : 'cotizacion_whatsapp');
      if (tipo === 'cotizacion_whatsapp' && !p.uid && !p.configApi && !p.configScraping) {
        return false;
      }
      if (filtroModo !== 'todos') {
        if (filtroModo === 'conexion_api_erp') {
          return tipo === 'conexion_api_erp' || tipo === 'nodo_ailoo';
        }
        return tipo === filtroModo;
      }
      return true;
    });
  }, [proveedores, filtroModo]);

  const listaFiltrada = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return integracionesTecnicas;
    return integracionesTecnicas.filter(
      (p) =>
        (p.nombre || '').toLowerCase().includes(q) ||
        (p.rut || '').toLowerCase().includes(q) ||
        (p.prefijoSku || '').toLowerCase().includes(q) ||
        (p.configApi?.endpointUrl || '').toLowerCase().includes(q) ||
        (p.configScraping?.portalUrl || '').toLowerCase().includes(q)
    );
  }, [integracionesTecnicas, busqueda]);

  const abrirNuevo = (modoInicial: TipoIntegracionProveedor = 'portal_erp_local') => {
    setEditingId(null);
    const prefijoDefault =
      modoInicial === 'conexion_api_erp'
        ? 'FRP-API'
        : modoInicial === 'scraping_portal_b2b'
        ? 'FRP-SCR'
        : 'FRP-TND';
    setForm({
      nombre: '',
      rut: '',
      contacto: '',
      email: '',
      telefono: '',
      direccion: '',
      tipoIntegracion: modoInicial,
      prefijoSku: prefijoDefault,
      margenPct: 30,
      notas: '',
      apiTipo: 'rest_json',
      apiEndpointUrl: '',
      apiKey: '',
      apiFrecuenciaSync: 'Cada 30 minutos (Delta)',
      scrapingPortalUrl: '',
      scrapingUsuario: '',
      scrapingClave: '',
      scrapingModo: 'catalogo_completo',
      scrapingSelectorPrecio: '',
      scrapingSelectorStock: '',
      passwordInicialTenant: '',
    });
    setModalAbierto(true);
  };

  const abrirEditar = (p: Proveedor) => {
    setEditingId(p.id || null);
    setForm({
      nombre: p.nombre || '',
      rut: p.rut || '',
      contacto: p.contacto || '',
      email: p.email || '',
      telefono: p.telefono || '',
      direccion: p.direccion || '',
      tipoIntegracion: p.tipoIntegracion || 'portal_erp_local',
      prefijoSku: p.prefijoSku || 'FRP-TND',
      margenPct: Number(p.margenPct) || 30,
      notas: p.notas || '',
      apiTipo: p.configApi?.tipo || 'rest_json',
      apiEndpointUrl: p.configApi?.endpointUrl || '',
      apiKey: p.configApi?.apiKey || '',
      apiFrecuenciaSync: p.configApi?.frecuenciaSync || 'Cada 30 minutos (Delta)',
      scrapingPortalUrl: p.configScraping?.portalUrl || '',
      scrapingUsuario: p.configScraping?.usuarioPortal || '',
      scrapingClave: p.configScraping?.clavePortal || '',
      scrapingModo: p.configScraping?.modoExtraccion || 'catalogo_completo',
      scrapingSelectorPrecio: p.configScraping?.selectorPrecio || '',
      scrapingSelectorStock: p.configScraping?.selectorStock || '',
      passwordInicialTenant: '',
    });
    setModalAbierto(true);
  };

  const handleGuardarIntegracion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      notify('Ingresa el nombre de la Tienda o Proveedor', 'error');
      return;
    }
    if (form.tipoIntegracion === 'portal_erp_local' && !form.rut.trim()) {
      notify('Para crear un Tenant ERP con usuario y clave, ingresa el RUT de la tienda', 'error');
      return;
    }

    setGuardando(true);
    try {
      const payload: Omit<Proveedor, 'id'> = {
        nombre: form.nombre.trim(),
        rut: form.rut.trim(),
        contacto: form.contacto.trim() || 'Administrador Tenant',
        email: form.email.trim(),
        telefono: form.telefono.trim(),
        direccion: form.direccion.trim(),
        categoria: 'General',
        categoriasEspecialidad: ['General'],
        marcas: [],
        notas: form.notas.trim(),
        tipoIntegracion: form.tipoIntegracion,
        canalWspActivo: false,
        margenPct: Number(form.margenPct) || 30,
        prefijoSku: form.prefijoSku.trim().toUpperCase() || 'FRP-TND',
        configApi:
          form.tipoIntegracion === 'conexion_api_erp' || form.tipoIntegracion === 'nodo_ailoo'
            ? {
                tipo: form.apiTipo,
                endpointUrl: form.apiEndpointUrl.trim(),
                apiKey: form.apiKey.trim(),
                frecuenciaSync: form.apiFrecuenciaSync,
                estadoConexion: 'configurado',
              }
            : null,
        configScraping:
          form.tipoIntegracion === 'scraping_portal_b2b'
            ? {
                portalUrl: form.scrapingPortalUrl.trim(),
                usuarioPortal: form.scrapingUsuario.trim(),
                clavePortal: form.scrapingClave.trim(),
                modoExtraccion: form.scrapingModo,
                selectorPrecio: form.scrapingSelectorPrecio.trim(),
                selectorStock: form.scrapingSelectorStock.trim(),
              }
            : null,
      };

      if (editingId) {
        await proveedoresService.update(editingId, payload);
        notify(`✓ Configuración de "${payload.nombre}" actualizada`, 'success');
      } else {
        const creado = await proveedoresService.create(payload);
        // Si es Tenant ERP y definió contraseña inicial, crear la cuenta de usuario automáticamente
        if (
          creado.success &&
          creado.data?.id &&
          form.tipoIntegracion === 'portal_erp_local' &&
          form.passwordInicialTenant.trim().length >= 6
        ) {
          await proveedoresService.darAcceso(
            creado.data.id,
            form.passwordInicialTenant.trim()
          );
          notify(
            `✓ Tenant ERP "${payload.nombre}" creado con usuario ${rutToEmail(payload.rut)} y clave activa`,
            'success'
          );
        } else {
          notify(`✓ Integración "${payload.nombre}" registrada correctamente`, 'success');
        }
      }

      setModalAbierto(false);
      await loadProveedores();
    } catch (err) {
      notify((err as Error).message || 'Error al guardar integración', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const abrirModalAcceso = (p: Proveedor) => {
    setAccesoProveedor(p);
    setAccesoPassword('');
    setAccesoModal(true);
  };

  const handleGuardarAccesoUsuario = async () => {
    if (!accesoProveedor?.id) return;
    if (!accesoProveedor.rut) {
      notify('Edita primero el proveedor y agrégale un RUT para generar su usuario de Tenant ERP', 'error');
      return;
    }
    if (accesoPassword.length < 6) {
      notify('La clave debe tener al menos 6 caracteres', 'error');
      return;
    }
    setDandoAcceso(true);
    try {
      const yaTiene = Boolean(accesoProveedor.uid);
      const res = yaTiene
        ? await proveedoresService.resetPassword(accesoProveedor.id, accesoPassword)
        : await proveedoresService.darAcceso(accesoProveedor.id, accesoPassword);
      if (res.success) {
        notify(
          yaTiene
            ? `✓ Clave actualizada para ${accesoProveedor.nombre}`
            : `✓ Usuario Tenant creado: ${rutToEmail(accesoProveedor.rut)}`,
          'success'
        );
        setAccesoModal(false);
        await loadProveedores();
      } else {
        notify(res.error || 'Error al configurar credenciales', 'error');
      }
    } catch {
      notify('Error al configurar credenciales de usuario', 'error');
    } finally {
      setDandoAcceso(false);
    }
  };

  const handleRevocarAcceso = async (p: Proveedor) => {
    if (!p.id) return;
    if (!confirm(`¿Revocar el acceso de usuario al Tenant ERP de "${p.nombre}"?`)) return;
    try {
      await proveedoresService.revocarAcceso(p.id);
      notify('Acceso revocado', 'info');
      await loadProveedores();
    } catch {
      notify('Error al revocar acceso', 'error');
    }
  };

  const handleEliminar = async (p: Proveedor) => {
    if (!p.id) return;
    if (!confirm(`¿Eliminar la integración "${p.nombre}"?`)) return;
    try {
      await proveedoresService.delete(p.id);
      notify('Integración eliminada', 'info');
      await loadProveedores();
    } catch {
      notify('Error al eliminar', 'error');
    }
  };

  const handleSyncNodosAiloo = async () => {
    setSincronizandoAiloo(true);
    try {
      const r = await woocommerceService.syncAilooTodos({ forzar: false });
      if (r.success) {
        notify('✓ Sincronización de Nodos Ailoo completada', 'success');
      }
    } catch {
      notify('Error al sincronizar Nodos Ailoo', 'error');
    } finally {
      setSincronizandoAiloo(false);
    }
  };

  const totalTenantsErp = integracionesTecnicas.filter(
    (p) => p.tipoIntegracion === 'portal_erp_local' || Boolean(p.uid)
  ).length;
  const totalApis = integracionesTecnicas.filter(
    (p) => p.tipoIntegracion === 'conexion_api_erp' || p.tipoIntegracion === 'nodo_ailoo'
  ).length;
  const totalScraping = integracionesTecnicas.filter(
    (p) => p.tipoIntegracion === 'scraping_portal_b2b'
  ).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabecera de Administración Técnica */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>
            🏭 Administración de Proveedores, Tenants ERP, APIs & Scraping
          </div>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: 4 }}>
            Levanta nuevas tiendas creando su <strong>Tenant ERP con Usuario y Clave</strong>, conecta un proveedor vía <strong>API / BigQuery (Ailoo)</strong>, o configura <strong>Scraping de Portales B2B</strong> para alimentar el compilado de <strong>ERP & Tiendas</strong>.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#ea580c', color: '#fff', fontWeight: 700 }}
            onClick={() => abrirNuevo('portal_erp_local')}
          >
            🏢 + Nuevo Tenant ERP / Tienda
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#2563eb', color: '#fff', fontWeight: 700 }}
            onClick={() => abrirNuevo('conexion_api_erp')}
          >
            🔌 + Conectar API / Solución ERP
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#7c3aed', color: '#fff', fontWeight: 700 }}
            onClick={() => abrirNuevo('scraping_portal_b2b')}
          >
            🕷️ + Agregar Portal para Scraping
          </button>
        </div>
      </div>

      {/* Tarjetas de los 3 Pilares de Administración */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 16,
            border: '1px solid #fed7aa',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#c2410c' }}>
            1. TENANTS ERP & ACCESOS DE USUARIOS
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
            {totalTenantsErp} Tiendas ERP
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
            Crea credenciales (<code>RUT@drmotors.internal</code> + clave) para que una tienda suba su stock y use su propio POS.
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 16,
            border: '1px solid #bfdbfe',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1d4ed8' }}>
            2. CONEXIONES API / NODOS AILOO
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
            {totalApis} Conectores API
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
            Integra soluciones externas (Soluparts Ailoo, Global Ailoo, APIs REST JSON/XML) con prefijo SKU propio.
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            padding: 16,
            border: '1px solid #ddd6fe',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#6d28d9' }}>
            3. SCRAPING DE PORTALES MAYORISTAS B2B
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', marginTop: 4 }}>
            {totalScraping} Portales Scraping
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>
            Configura URL, usuario/clave y selectores para extraer piezas, precios y stock de portales web de proveedores.
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Acciones */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['todos', `Todas las Integraciones (${integracionesTecnicas.length})`],
              ['portal_erp_local', `🏢 Tenants ERP (${totalTenantsErp})`],
              ['conexion_api_erp', `🔌 APIs & Ailoo (${totalApis})`],
              ['scraping_portal_b2b', `🕷️ Portales Scraping (${totalScraping})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${filtroModo === key ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFiltroModo(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleSyncNodosAiloo}
            disabled={sincronizandoAiloo}
          >
            {sincronizandoAiloo ? 'Sincronizando...' : '🔄 Ejecutar Sync Nodos Ailoo'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => navigate('/inventario-erp')}
          >
            🏢 Ver Compilado en ERP & Tiendas →
          </button>
          <input
            type="text"
            placeholder="Buscar tienda, prefijo SKU, URL..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: '0.82rem',
              minWidth: 210,
            }}
          />
        </div>
      </div>

      {/* Tabla de Administración de Tenants, APIs y Scraping */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Tienda / Proveedor Integrado</th>
                <th>Tipo de Conexión</th>
                <th>Prefijo SKU & Margen</th>
                <th>Endpoint API / Portal Scraping / Tenant</th>
                <th>Usuario & Acceso ERP</th>
                <th>Acciones de Administración</th>
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((p) => {
                const tipo = p.tipoIntegracion || 'portal_erp_local';
                const loginEmail = p.rut ? rutToEmail(p.rut) : 'Define RUT para crear usuario';

                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                        {p.nombre}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        RUT: {p.rut || '—'} · {p.contacto || 'Sin contacto'}
                      </div>
                    </td>

                    <td>
                      {tipo === 'nodo_ailoo' || tipo === 'conexion_api_erp' ? (
                        <span
                          style={{
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            padding: '4px 9px',
                            borderRadius: 999,
                            fontSize: '0.74rem',
                            fontWeight: 800,
                          }}
                        >
                          🔌 Conexión API / Ailoo
                        </span>
                      ) : tipo === 'scraping_portal_b2b' ? (
                        <span
                          style={{
                            background: '#ede9fe',
                            color: '#6d28d9',
                            padding: '4px 9px',
                            borderRadius: 999,
                            fontSize: '0.74rem',
                            fontWeight: 800,
                          }}
                        >
                          🕷️ Scraping Portal B2B
                        </span>
                      ) : (
                        <span
                          style={{
                            background: '#ffedd5',
                            color: '#c2410c',
                            padding: '4px 9px',
                            borderRadius: 999,
                            fontSize: '0.74rem',
                            fontWeight: 800,
                          }}
                        >
                          🏢 Tenant ERP Local
                        </span>
                      )}
                    </td>

                    <td>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0369a1' }}>
                        {p.prefijoSku || 'FRP-LOC'}-*
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>
                        Margen FRP: +{p.margenPct || 28}%
                      </div>
                    </td>

                    <td style={{ fontSize: '0.78rem', color: '#334155', maxWidth: 290 }}>
                      {p.configApi?.endpointUrl ? (
                        <div>
                          <div>
                            <strong>Endpoint:</strong> <code>{p.configApi.endpointUrl}</code>
                          </div>
                          <div style={{ color: '#64748b', fontSize: '0.72rem' }}>
                            Sync: {p.configApi.frecuenciaSync || 'Delta'}
                          </div>
                        </div>
                      ) : p.configScraping?.portalUrl ? (
                        <div>
                          <div>
                            <strong>Portal B2B:</strong> <code>{p.configScraping.portalUrl}</code>
                          </div>
                          <div style={{ color: '#64748b', fontSize: '0.72rem' }}>
                            Usuario B2B: {p.configScraping.usuarioPortal || '—'} · Modo:{' '}
                            {p.configScraping.modoExtraccion || 'Catálogo'}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div>
                            <strong>URL Tenant:</strong> <code>sistema.facilrepuestos.cl/proveedor</code>
                          </div>
                          <div style={{ color: '#64748b', fontSize: '0.72rem' }}>
                            Carga de catálogo, Excel, Factura IA y POS propio
                          </div>
                        </div>
                      )}
                    </td>

                    <td>
                      {p.uid ? (
                        <div>
                          <span
                            style={{
                              background: '#dcfce7',
                              color: '#15803d',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: '0.72rem',
                              fontWeight: 800,
                            }}
                          >
                            🟢 Usuario Activo
                          </span>
                          <div
                            style={{
                              fontSize: '0.73rem',
                              fontFamily: 'monospace',
                              color: '#334155',
                              marginTop: 4,
                            }}
                          >
                            {loginEmail}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Sin clave de usuario asignada
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => abrirModalAcceso(p)}
                        >
                          🔑 {p.uid ? 'Cambiar Clave' : 'Crear Usuario / Clave'}
                        </button>
                        {p.uid && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => handleRevocarAcceso(p)}
                            title="Revocar acceso de usuario"
                          >
                            🔒 Revocar
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => abrirEditar(p)}
                        >
                          ⚙️ Configurar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleEliminar(p)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
                    No hay integraciones registradas en este filtro. Usa los botones superiores para crear un Tenant ERP, conectar una API o agregar un Portal de Scraping.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal para Crear / Configurar Tenant ERP, API o Scraping */}
      {modalAbierto && (
        <div className="modal-overlay" onClick={() => setModalAbierto(false)}>
          <div
            className="modal"
            style={{ maxWidth: 680, width: '95%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                {editingId
                  ? '⚙️ Configurar Integración / Tenant'
                  : '🚀 Levantar Nuevo Proveedor / Tienda Integrada'}
              </div>
              <button className="modal-close" onClick={() => setModalAbierto(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarIntegracion}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Selector del Tipo de Solución */}
                <div>
                  <label className="form-label">Tipo de Integración Técnica</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {(
                      [
                        ['portal_erp_local', '🏢 Tenant ERP Propio', 'FRP-TND'],
                        ['conexion_api_erp', '🔌 Conexión API / ERP', 'FRP-API'],
                        ['scraping_portal_b2b', '🕷️ Scraping Portal B2B', 'FRP-SCR'],
                      ] as const
                    ).map(([val, label, pref]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            tipoIntegracion: val,
                            prefijoSku: editingId ? prev.prefijoSku : pref,
                          }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          fontWeight: 800,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          border:
                            form.tipoIntegracion === val
                              ? '2px solid #2563eb'
                              : '1px solid #cbd5e1',
                          background: form.tipoIntegracion === val ? '#eff6ff' : '#ffffff',
                          color: form.tipoIntegracion === val ? '#1d4ed8' : '#334155',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Datos Base de la Tienda / Proveedor */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nombre de la Tienda / Proveedor *</label>
                    <input
                      className="form-input"
                      placeholder="Ej. Importadora Autopar / Tienda Asociada"
                      value={form.nombre}
                      onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">RUT Empresa (Genera Usuario Tenant) *</label>
                    <input
                      className="form-input"
                      placeholder="76.123.456-7"
                      value={form.rut}
                      onChange={(e) => setForm((p) => ({ ...p, rut: formatRut(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Prefijo SKU Público en Catálogo</label>
                    <input
                      className="form-input"
                      placeholder="Ej. FRP-TND, FRP-API, FRP-SCR"
                      value={form.prefijoSku}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, prefijoSku: e.target.value.toUpperCase() }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Margen Comercial FácilRepuestos (%)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.margenPct}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, margenPct: Number(e.target.value) || 30 }))
                      }
                    />
                  </div>
                </div>

                {/* Bloque Específico 1: Tenant ERP Propio */}
                {form.tipoIntegracion === 'portal_erp_local' && (
                  <div
                    style={{
                      background: '#fff7ed',
                      border: '1px solid #fed7aa',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#9a3412' }}>
                      🏢 Credenciales de Tenant ERP para la Tienda
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#7c2d12' }}>
                      Usuario de acceso generado automáticamente:{' '}
                      <code>{rutToEmail(form.rut)}</code>
                    </div>
                    {!editingId && (
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">
                          Contraseña Inicial para el Tenant ERP (mín. 6 caracteres)
                        </label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Ej. tienda2026"
                          value={form.passwordInicialTenant}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, passwordInicialTenant: e.target.value }))
                          }
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Bloque Específico 2: Conexión API / ERP */}
                {(form.tipoIntegracion === 'conexion_api_erp' ||
                  form.tipoIntegracion === 'nodo_ailoo') && (
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#1e40af' }}>
                      🔌 Parámetros de Conexión API / Solución Externa
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Protocolo / Conector</label>
                        <select
                          className="form-select"
                          value={form.apiTipo}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              apiTipo: e.target.value as typeof form.apiTipo,
                            }))
                          }
                        >
                          <option value="rest_json">API REST JSON</option>
                          <option value="bigquery_ailoo">Nodo BigQuery / Ailoo</option>
                          <option value="graphql">GraphQL API</option>
                          <option value="xml_feed">Feed XML / CSV Remoto</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Frecuencia de Sincronización</label>
                        <input
                          className="form-input"
                          value={form.apiFrecuenciaSync}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, apiFrecuenciaSync: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">URL Endpoint / Dataset ID</label>
                      <input
                        className="form-input"
                        placeholder="Ej. https://api.proveedor.cl/v1/repuestos o bigquery://dataset.inventario"
                        value={form.apiEndpointUrl}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, apiEndpointUrl: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">API Key / Bearer Token</label>
                      <input
                        type="password"
                        className="form-input"
                        placeholder="Token o llave secreta de la API..."
                        value={form.apiKey}
                        onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                {/* Bloque Específico 3: Scraping de Portal B2B */}
                {form.tipoIntegracion === 'scraping_portal_b2b' && (
                  <div
                    style={{
                      background: '#f5f3ff',
                      border: '1px solid #ddd6fe',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#5b21b6' }}>
                      🕷️ Configuración de Scraping de Portal Mayorista B2B
                    </div>
                    <div className="form-group">
                      <label className="form-label">URL del Portal B2B del Proveedor *</label>
                      <input
                        className="form-input"
                        placeholder="Ej. https://b2b.importadorarepuestos.cl/catalogo"
                        value={form.scrapingPortalUrl}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, scrapingPortalUrl: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Usuario Login Portal B2B</label>
                        <input
                          className="form-input"
                          placeholder="Usuario cliente mayorista"
                          value={form.scrapingUsuario}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, scrapingUsuario: e.target.value }))
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Clave Login Portal B2B</label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="••••••••"
                          value={form.scrapingClave}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, scrapingClave: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Modo de Extracción</label>
                        <select
                          className="form-select"
                          value={form.scrapingModo}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              scrapingModo: e.target.value as typeof form.scrapingModo,
                            }))
                          }
                        >
                          <option value="catalogo_completo">
                            Barrido de Catálogo Completo + Stock
                          </option>
                          <option value="consulta_sku_demanda">
                            Consulta en vivo por SKU / OEM bajo demanda
                          </option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Selector CSS / JSON de Precio y Stock</label>
                        <input
                          className="form-input"
                          placeholder="Ej. .price-neto, .stock-badge"
                          value={form.scrapingSelectorPrecio}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, scrapingSelectorPrecio: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Notas Técnicas / Acuerdos de Integración</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Detalles técnicos de la conexión, horarios de corte o condiciones..."
                    value={form.notas}
                    onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setModalAbierto(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : '✓ Guardar Integración'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para Crear / Cambiar Clave de Usuario Tenant ERP */}
      {accesoModal && accesoProveedor && (
        <div className="modal-overlay" onClick={() => setAccesoModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 460, width: '95%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                🔑 Credenciales Tenant ERP — {accesoProveedor.nombre}
              </div>
              <button className="modal-close" onClick={() => setAccesoModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                  fontSize: '0.82rem',
                }}
              >
                <div>
                  <strong>URL Portal ERP:</strong>{' '}
                  <code>https://sistema.facilrepuestos.cl/login</code>
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong>Usuario / RUT de ingreso:</strong>{' '}
                  <code>{accesoProveedor.rut || 'Sin RUT'}</code> (o{' '}
                  <code>{rutToEmail(accesoProveedor.rut)}</code>)
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">
                  {accesoProveedor.uid ? 'Nueva Contraseña' : 'Crear Contraseña Inicial'} (mín. 6
                  caracteres)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ingresa la clave para esta tienda..."
                  value={accesoPassword}
                  onChange={(e) => setAccesoPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setAccesoModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={dandoAcceso}
                onClick={handleGuardarAccesoUsuario}
              >
                {dandoAcceso
                  ? 'Guardando...'
                  : accesoProveedor.uid
                  ? '✓ Actualizar Clave'
                  : '✓ Crear Acceso Tenant ERP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
