import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { proveedoresService } from '../../services/proveedores';
import type { Proveedor, TipoIntegracionProveedor } from '../../types';
import { MARCAS_VEHICULOS } from '../../types';
import { marcasVehiculoService } from '../../services/marcasVehiculo';
import type { MarcaVehiculo } from '../../services/marcasVehiculo';
import {
  validarTelefonoChileno,
  errorTelefono,
  formatRut,
} from '../../utils/validaciones';
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './Proveedores.module.css';

const CATEGORIAS = [
  'Frenos', 'Embrague', 'Motor', 'Suspensión',
  'Distribución', 'Eléctrico', 'Transmisión', 'Carrocería',
  'Filtros', 'Lubricantes', 'Neumáticos', 'General', 'Otros',
];

const TIPOS_INTEGRACION: {
  value: TipoIntegracionProveedor;
  label: string;
  badge: string;
  desc: string;
  defaultPrefix: string;
}[] = [
  {
    value: 'cotizacion_whatsapp',
    label: '📲 Cotización WhatsApp en Vivo (Etapa 3)',
    badge: '📲 WhatsApp Etapa 3',
    desc: 'Sin ERP propio. Recibe solicitudes automáticas de cotización por WhatsApp cuando no hay stock en catálogo.',
    defaultPrefix: 'FRP-WSP',
  },
  {
    value: 'portal_erp_local',
    label: '🏭 Portal Proveedor ERP Local (Etapa 1 y 2)',
    badge: '🏭 Portal ERP Local',
    desc: 'Sube su inventario al Portal Proveedor y responde escalamientos técnicos en su bandeja.',
    defaultPrefix: 'FRP-LOC',
  },
  {
    value: 'hibrido_erp_wsp',
    label: '⚡ Híbrido (Portal ERP + Mesa WhatsApp)',
    badge: '⚡ Híbrido ERP + WSP',
    desc: 'Opera con catálogo en Portal ERP y además recibe cotizaciones urgentes por WhatsApp en vivo.',
    defaultPrefix: 'FRP-LOC',
  },
  {
    value: 'nodo_ailoo',
    label: '🔗 Nodo Enterprise Ailoo (BigQuery Sync)',
    badge: '🔗 Nodo Enterprise Ailoo',
    desc: 'Sincronización corporativa bidireccional vía BigQuery (inventario + escalamientos expertos).',
    defaultPrefix: 'FRP-AIL',
  },
];

const emptyProveedor = (): Omit<Proveedor, 'id'> => ({
  nombre: '',
  rut: '',
  contacto: '',
  telefono: '',
  email: '',
  direccion: '',
  categoria: 'Frenos',
  categoriasEspecialidad: ['Frenos'],
  marcas: [],
  notas: '',
  tipoIntegracion: 'cotizacion_whatsapp',
  canalWspActivo: true,
  margenPct: 28,
  prefijoSku: 'FRP-WSP',
  tiempoRespuestaPromMin: 5,
});

export default function Proveedores() {
  const navigate = useNavigate();
  const { proveedores, setProveedores, setLoading, notify } = useAppStore();
  const [search, setSearch] = useState('');
  const [filtrocat, setFiltrocat] = useState('');
  const [filtroCanal, setFiltroCanal] = useState('');
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Proveedor, 'id'>>(emptyProveedor());
  const [errorTel, setErrorTel] = useState('');

  // Para agregar marcas personalizadas
  const [marcaCustom, setMarcaCustom] = useState('');
  const [marcasExtra, setMarcasExtra] = useState<string[]>([]);
  const [marcasPersistidas, setMarcasPersistidas] = useState<MarcaVehiculo[]>([]);
  const [guardandoMarca, setGuardandoMarca] = useState(false);

  // Acceso al Panel Proveedor
  const [accesoModal, setAccesoModal] = useState(false);
  const [accesoProveedor, setAccesoProveedor] = useState<Proveedor | null>(null);
  const [accesoPassword, setAccesoPassword] = useState('');
  const [dandoAcceso, setDandoAcceso] = useState(false);

  useEffect(() => {
    loadProveedores();
    loadMarcas();
  }, []);

  const loadMarcas = async () => {
    try {
      const r = await marcasVehiculoService.getAll();
      if (r.success && r.data) setMarcasPersistidas(r.data);
    } catch {}
  };

  // Lista completa: fijas del sistema + las que se han ido agregando y guardando
  const allMarcas = [
    ...MARCAS_VEHICULOS.filter((m) => m !== 'OTRO'),
    ...marcasPersistidas.map((m) => m.nombre).filter((n) => !MARCAS_VEHICULOS.includes(n)),
  ];

  const loadProveedores = async () => {
    setLoading(true);
    try {
      const res = await proveedoresService.getAll();
      if (res.success && res.data) setProveedores(res.data);
    } catch {
      notify('Error al cargar proveedores', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openNuevo = () => {
    setEditingId(null);
    setForm(emptyProveedor());
    setMarcasExtra([]);
    setMarcaCustom('');
    setErrorTel('');
    setModal(true);
  };

  const openEditar = (p: Proveedor) => {
    setEditingId(p.id!);
    const marcasFuente = p.marcas || p.marcasVehiculo || [];
    const marcasConocidas = marcasFuente.filter((m) => allMarcas.includes(m));
    const extra = marcasFuente.filter((m) => !allMarcas.includes(m));
    const cats =
      Array.isArray(p.categoriasEspecialidad) && p.categoriasEspecialidad.length > 0
        ? p.categoriasEspecialidad
        : p.categoria
          ? [p.categoria]
          : ['General'];

    const tipoInt: TipoIntegracionProveedor =
      p.tipoIntegracion ||
      (p.nodoAilooId
        ? 'nodo_ailoo'
        : p.uid && p.canalWspActivo
          ? 'hibrido_erp_wsp'
          : p.uid
            ? 'portal_erp_local'
            : 'cotizacion_whatsapp');

    setForm({
      nombre: p.nombre || '',
      rut: p.rut || '',
      contacto: p.contacto || '',
      telefono: p.telefono || '',
      email: p.email || '',
      direccion: p.direccion || '',
      categoria: p.categoria || cats[0] || 'General',
      categoriasEspecialidad: cats,
      marcas: marcasConocidas,
      notas: p.notas || '',
      tipoIntegracion: tipoInt,
      canalWspActivo:
        p.canalWspActivo !== undefined
          ? Boolean(p.canalWspActivo)
          : tipoInt === 'cotizacion_whatsapp' || tipoInt === 'hibrido_erp_wsp',
      margenPct: Number(p.margenPct) > 0 ? Number(p.margenPct) : 28,
      prefijoSku:
        p.prefijoSku ||
        (tipoInt === 'nodo_ailoo' ? 'FRP-AIL' : tipoInt === 'cotizacion_whatsapp' ? 'FRP-WSP' : 'FRP-LOC'),
      tiempoRespuestaPromMin: Number(p.tiempoRespuestaPromMin) > 0 ? Number(p.tiempoRespuestaPromMin) : 5,
      nodoAilooId: p.nodoAilooId || null,
    });
    setMarcasExtra(extra);
    setMarcaCustom('');
    setErrorTel('');
    setModal(true);
  };

  const toggleMarca = (marca: string) => {
    const current = form.marcas || [];
    if (current.includes(marca)) {
      setForm((prev) => ({ ...prev, marcas: current.filter((m) => m !== marca) }));
    } else {
      setForm((prev) => ({ ...prev, marcas: [...current, marca] }));
    }
  };

  const toggleCategoriaEspecialidad = (cat: string) => {
    const actuales = form.categoriasEspecialidad || [];
    let nuevas: string[];
    if (actuales.includes(cat)) {
      nuevas = actuales.filter((c) => c !== cat);
      if (nuevas.length === 0) nuevas = ['General'];
    } else {
      nuevas = [...actuales, cat];
    }
    setForm((prev) => ({
      ...prev,
      categoriasEspecialidad: nuevas,
      categoria: nuevas[0] || prev.categoria || 'General',
    }));
  };

  const handleChangeTipoIntegracion = (nuevoTipo: TipoIntegracionProveedor) => {
    const info = TIPOS_INTEGRACION.find((t) => t.value === nuevoTipo);
    const activarWsp = nuevoTipo === 'cotizacion_whatsapp' || nuevoTipo === 'hibrido_erp_wsp';
    setForm((prev) => ({
      ...prev,
      tipoIntegracion: nuevoTipo,
      canalWspActivo: activarWsp,
      prefijoSku: info?.defaultPrefix || prev.prefijoSku || 'FRP-LOC',
    }));
  };

  const handleToggleWspDirecto = async (p: Proveedor) => {
    if (!p.id) return;
    const nuevoEstado = !p.canalWspActivo;
    try {
      await proveedoresService.update(p.id, {
        ...p,
        canalWspActivo: nuevoEstado,
      });
      notify(
        nuevoEstado
          ? `📲 ${p.nombre} activado en Mesa WhatsApp (Etapa 3)`
          : `Canal WhatsApp pausado para ${p.nombre}`,
        'success'
      );
      loadProveedores();
    } catch {
      notify('Error al actualizar estado de WhatsApp', 'error');
    }
  };

  const agregarMarcaCustom = async () => {
    const m = marcaCustom.trim().toUpperCase();
    if (!m) return;
    if (allMarcas.includes(m) || marcasExtra.includes(m) || form.marcas.includes(m)) {
      notify('Esa marca ya está en la lista', 'error');
      return;
    }
    setGuardandoMarca(true);
    try {
      const r = await marcasVehiculoService.create(m);
      if (r.success) {
        notify(`Marca "${m}" agregada ✓`, 'success');
        setMarcaCustom('');
        await loadMarcas();
        setForm((prev) => ({ ...prev, marcas: [...(prev.marcas || []), m] }));
      } else {
        notify(r.error || 'Error al guardar la marca', 'error');
      }
    } catch {
      notify('Error al guardar la marca', 'error');
    } finally {
      setGuardandoMarca(false);
    }
  };

  const removeMarcaExtra = (m: string) => {
    setMarcasExtra(marcasExtra.filter((x) => x !== m));
  };

  const abrirAcceso = (p: Proveedor) => {
    setAccesoProveedor(p);
    setAccesoPassword('');
    setAccesoModal(true);
  };

  const handleDarAcceso = async () => {
    if (!accesoProveedor?.id) return;
    if (!accesoProveedor.rut) {
      notify('Este proveedor necesita un RUT para poder tener acceso', 'error');
      return;
    }
    if (accesoPassword.length < 6) {
      notify('La contraseña debe tener mínimo 6 caracteres', 'error');
      return;
    }
    setDandoAcceso(true);
    try {
      const esReset = !!accesoProveedor.uid;
      const r = esReset
        ? await proveedoresService.resetPassword(accesoProveedor.id, accesoPassword)
        : await proveedoresService.darAcceso(accesoProveedor.id, accesoPassword);
      if (r.success) {
        notify(esReset ? 'Contraseña actualizada ✓' : 'Acceso creado ✓', 'success');
        setAccesoModal(false);
        loadProveedores();
      } else {
        notify(r.error || 'Error', 'error');
      }
    } catch {
      notify('Error al procesar el acceso', 'error');
    } finally {
      setDandoAcceso(false);
    }
  };

  const handleRevocarAcceso = async (p: Proveedor) => {
    if (!p.id) return;
    if (!confirm(`¿Revocar el acceso al portal de "${p.nombre}"? Podrás volver a crearlo después.`)) return;
    setLoading(true);
    try {
      await proveedoresService.revocarAcceso(p.id);
      notify('Acceso revocado', 'info');
      loadProveedores();
    } catch {
      notify('Error al revocar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.nombre) {
      notify('Ingresa el nombre del proveedor', 'error');
      return;
    }
    if (form.canalWspActivo && !form.telefono) {
      notify('Para activar cotizaciones por WhatsApp (Etapa 3), ingresa el teléfono WhatsApp del proveedor', 'error');
      return;
    }
    setLoading(true);
    try {
      const todasMarcas = [...(form.marcas || []), ...marcasExtra];
      const cats =
        Array.isArray(form.categoriasEspecialidad) && form.categoriasEspecialidad.length > 0
          ? form.categoriasEspecialidad
          : [form.categoria || 'General'];
      const data: Omit<Proveedor, 'id'> = {
        ...form,
        categoria: cats[0] || form.categoria || 'General',
        categoriasEspecialidad: cats,
        marcas: todasMarcas,
        marcasVehiculo: todasMarcas,
      };
      if (editingId) {
        await proveedoresService.update(editingId, data);
        notify('Proveedor actualizado con configuración omnicanal ✓', 'success');
      } else {
        await proveedoresService.create(data);
        notify('Proveedor agregado a la red FácilRepuestos ✓', 'success');
      }
      setModal(false);
      loadProveedores();
    } catch {
      notify('Error al guardar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el proveedor "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
    setLoading(true);
    try {
      await proveedoresService.delete(id);
      notify('Proveedor eliminado', 'info');
      loadProveedores();
    } catch {
      notify('Error al eliminar', 'error');
    } finally {
      setLoading(false);
    }
  };

  const setField = (field: keyof typeof form, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const filtered = proveedores.filter((p) => {
    const q = search.toLowerCase();
    const marcasProv = p.marcas || p.marcasVehiculo || [];
    const catsProv =
      Array.isArray(p.categoriasEspecialidad) && p.categoriasEspecialidad.length > 0
        ? p.categoriasEspecialidad
        : [p.categoria].filter(Boolean);

    const matchSearch =
      !q ||
      p.nombre.toLowerCase().includes(q) ||
      (p.contacto || '').toLowerCase().includes(q) ||
      (p.rut || '').toLowerCase().includes(q) ||
      (p.prefijoSku || '').toLowerCase().includes(q) ||
      marcasProv.some((m) => m.toLowerCase().includes(q)) ||
      catsProv.some((c) => c.toLowerCase().includes(q));

    const matchCat = !filtrocat || p.categoria === filtrocat || catsProv.includes(filtrocat);

    const matchCanal =
      !filtroCanal ||
      (filtroCanal === 'wsp_activo' && Boolean(p.canalWspActivo)) ||
      (filtroCanal === 'portal_erp' && (Boolean(p.uid) || p.tipoIntegracion === 'portal_erp_local')) ||
      p.tipoIntegracion === filtroCanal;

    return matchSearch && matchCat && matchCanal;
  });

  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  const totalWspActivos = proveedores.filter((p) => p.canalWspActivo && p.telefono).length;
  const totalPortalONodo = proveedores.filter(
    (p) => Boolean(p.uid) || p.tipoIntegracion === 'portal_erp_local' || p.tipoIntegracion === 'nodo_ailoo'
  ).length;
  const margenPromedio =
    proveedores.length > 0
      ? Math.round(
          proveedores.reduce((acc, p) => acc + (Number(p.margenPct) || 28), 0) / proveedores.length
        )
      : 28;

  const renderBadgeCanal = (p: Proveedor) => {
    const tipo = p.tipoIntegracion || (p.uid ? 'portal_erp_local' : 'cotizacion_whatsapp');
    if (tipo === 'nodo_ailoo') {
      return <span className={`${styles.badgeCanal} ${styles.canalAiloo}`}>🔗 Nodo Enterprise Ailoo</span>;
    }
    if (tipo === 'hibrido_erp_wsp') {
      return <span className={`${styles.badgeCanal} ${styles.canalHibrido}`}>⚡ Híbrido ERP + WSP</span>;
    }
    if (tipo === 'portal_erp_local') {
      return <span className={`${styles.badgeCanal} ${styles.canalErp}`}>🏭 Portal ERP Local</span>;
    }
    return <span className={`${styles.badgeCanal} ${styles.canalWsp}`}>📲 WhatsApp Etapa 3</span>;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Red Omnicanal de Proveedores</div>
          <div className={styles.pageSub}>
            Configura qué proveedores operan por Portal ERP, Nodos Ailoo o Mesa de Cotización en Vivo por WhatsApp (Etapa 3), sus marcas especialistas y márgenes comerciales.
          </div>
        </div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar proveedor, marca, rubro, prefijo..."
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={styles.filtroCanal}
            value={filtroCanal}
            onChange={(e) => setFiltroCanal(e.target.value)}
          >
            <option value="">Todos los canales</option>
            <option value="wsp_activo">📲 Activos en Mesa WhatsApp (Etapa 3)</option>
            <option value="cotizacion_whatsapp">📲 Solo Cotización WhatsApp</option>
            <option value="portal_erp">🏭 Con Portal ERP Local</option>
            <option value="hibrido_erp_wsp">⚡ Híbrido (ERP + WhatsApp)</option>
            <option value="nodo_ailoo">🔗 Nodos Enterprise Ailoo</option>
          </select>
          <select
            className={styles.filtroCategoria}
            value={filtrocat}
            onChange={(e) => setFiltrocat(e.target.value)}
          >
            <option value="">Todas las especialidades</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={openNuevo}>
            + Nuevo Proveedor
          </button>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{proveedores.length}</div>
          <div className="stat-label">Total Red Proveedores</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statConMarcas}`}>{totalWspActivos}</div>
          <div className="stat-label">📲 Activos en Mesa WhatsApp</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statConEmail}`}>{totalPortalONodo}</div>
          <div className="stat-label">🏭 Portal ERP / Nodos Ailoo</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">+{margenPromedio}%</div>
          <div className="stat-label">💰 Margen Promedio FRP</div>
        </div>
      </div>

      {/* ── TABLA ──────────────────────────────────────── */}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={filtered.length}
        pageSize={pageSize}
        onPage={goTo}
        onPageSize={changeSize}
      />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Proveedor / RUT</th>
              <th>Canal Omnicanal & WhatsApp</th>
              <th>Especialidades Técnicas</th>
              <th>Marcas Especialistas</th>
              <th>Regla Comercial FRP</th>
              <th>Contacto / WhatsApp</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyRow}>
                  No hay proveedores que coincidan con los filtros seleccionados
                </td>
              </tr>
            )}
            {paged.map((p) => {
              const cats =
                Array.isArray(p.categoriasEspecialidad) && p.categoriasEspecialidad.length > 0
                  ? p.categoriasEspecialidad
                  : [p.categoria || 'General'];
              const marcasProv = p.marcas || p.marcasVehiculo || [];
              return (
                <tr key={p.id}>
                  <td data-label="Proveedor">
                    <div className={styles.cellNombre}>{p.nombre}</div>
                    <div className={styles.cellRut}>
                      RUT: {p.rut || '—'}
                      {p.tiempoRespuestaPromMin ? ` · ⏱ SLA ~${p.tiempoRespuestaPromMin} min` : ''}
                    </div>
                  </td>

                  <td data-label="Canal Omnicanal">
                    <div className={styles.canalCellCol}>
                      {renderBadgeCanal(p)}
                      <button
                        type="button"
                        onClick={() => handleToggleWspDirecto(p)}
                        className={`${styles.wspTogglePill} ${
                          p.canalWspActivo ? styles.wspToggleOn : styles.wspToggleOff
                        }`}
                        title="Haz clic para activar/pausar la recepción de cotizaciones automáticas por WhatsApp (Etapa 3)"
                      >
                        {p.canalWspActivo ? '🟢 Recibe Cotización WSP' : '⚪ WSP Pausado'}
                      </button>
                    </div>
                  </td>

                  <td data-label="Especialidades">
                    <div className={styles.catsRow}>
                      {cats.map((c) => (
                        <span key={c} className={styles.badgeCat}>
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td data-label="Marcas Especialistas">
                    {marcasProv.length > 0 ? (
                      <div className={styles.marcasRow}>
                        {marcasProv.slice(0, 5).map((m) => (
                          <span key={m} className={styles.badgeMarca}>
                            {m}
                          </span>
                        ))}
                        {marcasProv.length > 5 && (
                          <span className={styles.badgeMore}>+{marcasProv.length - 5} más</span>
                        )}
                      </div>
                    ) : (
                      <span className={styles.dash}>Multimarca</span>
                    )}
                  </td>

                  <td data-label="Regla Comercial FRP">
                    <div className={styles.comercialCell}>
                      <span className={styles.margenBadge}>+{p.margenPct ?? 28}% Margen</span>
                      <span className={styles.prefijoBadge}>
                        SKU: {p.prefijoSku || 'FRP-LOC'}-*
                      </span>
                    </div>
                  </td>

                  <td data-label="Contacto" className="hide-mobile">
                    <div className={styles.contactoNombre}>{p.contacto || '—'}</div>
                    <div className={styles.contactoTel}>{p.telefono || 'Sin teléfono'}</div>
                    {p.email && <div className={styles.contactoEmail}>{p.email}</div>}
                  </td>

                  <td data-label="Acciones">
                    <div className={styles.accionesCol}>
                      {p.canalWspActivo && p.telefono && (
                        <button
                          className={`btn btn-sm ${styles.btnWspAction}`}
                          onClick={() => navigate('/mesa-wsp')}
                        >
                          📲 Mesa WSP
                        </button>
                      )}
                      <button className="btn btn-outline btn-sm" onClick={() => openEditar(p)}>
                        ✏ Editar
                      </button>
                      {p.uid ? (
                        <button className="btn btn-dark btn-sm" onClick={() => abrirAcceso(p)}>
                          🔑 Restablecer clave
                        </button>
                      ) : (
                        <button className="btn btn-dark btn-sm" onClick={() => abrirAcceso(p)}>
                          🔑 Dar Acceso Portal
                        </button>
                      )}
                      {p.uid && (
                        <button
                          className={`btn btn-sm ${styles.btnDanger}`}
                          onClick={() => handleRevocarAcceso(p)}
                        >
                          ✕ Revocar Acceso
                        </button>
                      )}
                      <button
                        className={`btn btn-sm ${styles.btnDanger}`}
                        onClick={() => handleDelete(p.id!, p.nombre)}
                      >
                        ✕ Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── MODAL CREAR / EDITAR PROVEEDOR ─────────────────────────── */}
      {modal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalProveedorForm}`}>
            <div className="modal-title">
              {editingId ? 'Editar Proveedor Omnicanal' : 'Nuevo Proveedor Omnicanal'}
            </div>

            {/* Datos básicos */}
            <div className="form-grid fg-2">
              <div className={`field ${styles.fullWidth}`}>
                <label>Nombre o Razón Social *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setField('nombre', e.target.value.toUpperCase())}
                  placeholder="Ej: IMPORTADORA COREAPARTS 10 DE JULIO"
                />
              </div>
              <div className="field">
                <label>RUT Empresa</label>
                <input
                  value={form.rut}
                  onChange={(e) => setField('rut', formatRut(e.target.value))}
                  placeholder="76.123.456-7"
                  maxLength={12}
                />
              </div>
              <div className="field">
                <label>Nombre Ejecutivo / Mesón</label>
                <input
                  value={form.contacto}
                  onChange={(e) => setField('contacto', e.target.value)}
                  placeholder="Ej: Don Patricio Rojas (Mesón WSP)"
                />
              </div>
              <div className="field">
                <label>Teléfono / WhatsApp Cotizaciones *</label>
                <input
                  value={form.telefono}
                  onChange={(e) => {
                    setField('telefono', e.target.value);
                    setErrorTel('');
                  }}
                  onBlur={() => {
                    if (form.telefono && !validarTelefonoChileno(form.telefono)) setErrorTel(errorTelefono);
                  }}
                  placeholder="+569 8412 0931"
                  className={errorTel ? styles.inputError : ''}
                />
                {errorTel && <span className={styles.fieldError}>{errorTel}</span>}
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="ventas@proveedor.cl"
                />
              </div>
              <div className={`field ${styles.fullWidth}`}>
                <label>Dirección Comercial / Bodega</label>
                <input
                  value={form.direccion}
                  onChange={(e) => setField('direccion', e.target.value)}
                  placeholder="Ej: Av. 10 de Julio 482, Santiago"
                />
              </div>
            </div>

            {/* ── SECCIÓN INTEGRACIÓN OMNICANAL Y REGLA COMERCIAL ───────── */}
            <div className="modal-sep" />
            <div className={styles.sectionTitle}>
              <span className={styles.sectionTitleBar} />
              Canal de Integración Omnicanal y Regla Comercial FácilRepuestos
            </div>

            <div className="form-grid fg-2">
              <div className={`field ${styles.fullWidth}`}>
                <label>Tipo de Integración con FácilRepuestos</label>
                <select
                  value={form.tipoIntegracion || 'cotizacion_whatsapp'}
                  onChange={(e) =>
                    handleChangeTipoIntegracion(e.target.value as TipoIntegracionProveedor)
                  }
                >
                  {TIPOS_INTEGRACION.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className={styles.helperText}>
                  {
                    TIPOS_INTEGRACION.find((t) => t.value === form.tipoIntegracion)?.desc
                  }
                </span>
              </div>

              <div className={`field ${styles.fullWidth}`}>
                <label className={styles.wspCheckboxBox}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.canalWspActivo)}
                    onChange={(e) => setField('canalWspActivo', e.target.checked)}
                  />
                  <div>
                    <strong>📲 Recibe cotizaciones automáticas en vivo por WhatsApp (Etapa 3)</strong>
                    <div className={styles.wspCheckboxSub}>
                      Cuando el Agente Omnicanal o la Mesa de Cotización busquen un repuesto sin stock de las marcas y especialidades de este proveedor, se le enviará automáticamente la consulta por WhatsApp.
                    </div>
                  </div>
                </label>
              </div>

              <div className="field">
                <label>Margen Comercial FácilRepuestos (%)</label>
                <input
                  type="number"
                  min={5}
                  max={150}
                  value={form.margenPct ?? 28}
                  onChange={(e) => setField('margenPct', Number(e.target.value))}
                />
              </div>

              <div className="field">
                <label>Prefijo SKU Público (Oculta SKU proveedor)</label>
                <input
                  value={form.prefijoSku || 'FRP-WSP'}
                  onChange={(e) => setField('prefijoSku', e.target.value.toUpperCase())}
                  placeholder="FRP-WSP / FRP-LOC"
                />
              </div>

              <div className="field">
                <label>SLA Tiempo de Respuesta Estimado (min)</label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={form.tiempoRespuestaPromMin ?? 5}
                  onChange={(e) => setField('tiempoRespuestaPromMin', Number(e.target.value))}
                />
              </div>

              <div className="field">
                <label>Categoría Principal</label>
                <select
                  value={form.categoria}
                  onChange={(e) => setField('categoria', e.target.value)}
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Especialidades Técnicas Múltiples */}
            <div className="modal-sep" />
            <div className={styles.sectionTitle}>
              <span className={styles.sectionTitleBar} />
              Especialidades Técnicas que Cotiza (Filtro Automático Etapa 3)
            </div>
            <div className={styles.marcasGrid}>
              {CATEGORIAS.map((cat) => {
                const selected = (form.categoriasEspecialidad || []).includes(cat);
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => toggleCategoriaEspecialidad(cat)}
                    className={`${styles.marcaToggle} ${selected ? styles.marcaToggleActive : ''}`}
                  >
                    {selected ? '✓ ' : ''}
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Marcas */}
            <div className="modal-sep" />
            <div className={styles.sectionTitle}>
              <span className={styles.sectionTitleBar} />
              Marcas de Vehículos Especialistas
            </div>

            <div className={styles.marcasGrid}>
              {allMarcas.map((m) => {
                const selected = (form.marcas || []).includes(m);
                return (
                  <button
                    type="button"
                    key={m}
                    onClick={() => toggleMarca(m)}
                    className={`${styles.marcaToggle} ${selected ? styles.marcaToggleActive : ''}`}
                  >
                    {selected ? '✓ ' : ''}
                    {m}
                  </button>
                );
              })}
            </div>

            {/* Marcas personalizadas */}
            {marcasExtra.length > 0 && (
              <div className={styles.marcasExtraRow}>
                {marcasExtra.map((m) => (
                  <span key={m} className={styles.chipMarcaExtra}>
                    {m}
                    <span
                      className={styles.chipRemoveExtra}
                      onClick={() => removeMarcaExtra(m)}
                    >
                      ✕
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.customAddRow}>
              <input
                type="text"
                value={marcaCustom}
                onChange={(e) => setMarcaCustom(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && agregarMarcaCustom()}
                placeholder="Agregar marca no listada..."
                className={styles.flexInput}
              />
              <button
                type="button"
                className="btn btn-dark btn-sm"
                onClick={agregarMarcaCustom}
                disabled={!marcaCustom.trim() || guardandoMarca}
              >
                {guardandoMarca ? 'Guardando...' : '+ Agregar'}
              </button>
            </div>

            {/* Marcas seleccionadas resumen */}
            {((form.marcas || []).length > 0 || marcasExtra.length > 0) && (
              <div className={styles.resumenBox}>
                <strong className={styles.resumenStrong}>
                  {(form.marcas || []).length + marcasExtra.length} marca(s) especialista(s):
                </strong>{' '}
                {[...(form.marcas || []), ...marcasExtra].join(', ')}
              </div>
            )}

            {/* Notas */}
            <div className="field">
              <label>Notas Técnicas y Condiciones de Mesón</label>
              <textarea
                value={form.notas}
                onChange={(e) => setField('notas', e.target.value)}
                rows={2}
                className={styles.textarea}
                placeholder="Ej: Especialista en motores diésel coreanos D4CB/D4BH, responde WhatsApp con foto de mesón..."
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModal(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                💾 Guardar Proveedor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL ACCESO PORTAL ─────────────────────────── */}
      {accesoModal && accesoProveedor && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">
              {accesoProveedor.uid ? 'Restablecer Contraseña' : 'Dar Acceso al Portal'}
            </div>
            <div className="modal-sub">
              {accesoProveedor.nombre} · RUT {accesoProveedor.rut || '—'}
              {!accesoProveedor.uid && (
                <> — accederá con su RUT y esta contraseña, y solo verá sus propios repuestos y escalamientos.</>
              )}
            </div>
            <div className="field">
              <label>{accesoProveedor.uid ? 'Nueva Contraseña' : 'Contraseña'}</label>
              <input
                type="text"
                value={accesoPassword}
                onChange={(e) => setAccesoPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setAccesoModal(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleDarAcceso} disabled={dandoAcceso}>
                {dandoAcceso ? 'Guardando...' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
