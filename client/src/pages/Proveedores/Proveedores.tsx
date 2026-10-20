import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { proveedoresService } from '../../services/proveedores';
import type { Proveedor } from '../../types';
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
  'Frenos', 'Filtros', 'Lubricantes', 'Suspensión',
  'Eléctrico', 'Distribución', 'Neumáticos', 'Embrague',
  'Herramientas', 'General', 'Otros',
];

const emptyProveedor = (): Omit<Proveedor, 'id'> => ({
  nombre: '', rut: '', contacto: '', telefono: '',
  email: '', direccion: '', categoria: 'General',
  marcas: [], notas: '',
});

export default function Proveedores() {
  const { proveedores, setProveedores, setLoading, notify } = useAppStore();
  const [search, setSearch] = useState('');
  const [filtrocat, setFiltrocat] = useState('');
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Proveedor, 'id'>>(emptyProveedor());
  const [errorTel, setErrorTel] = useState('');

  // Para agregar marcas personalizadas
  const [marcaCustom, setMarcaCustom] = useState('');
  const [marcasExtra, setMarcasExtra] = useState<string[]>([]);
  const [marcasPersistidas, setMarcasPersistidas] = useState<MarcaVehiculo[]>([]);
  const [guardandoMarca, setGuardandoMarca]       = useState(false);

  // Acceso al Panel Proveedor
  const [accesoModal, setAccesoModal]         = useState(false);
  const [accesoProveedor, setAccesoProveedor] = useState<Proveedor | null>(null);
  const [accesoPassword, setAccesoPassword]   = useState('');
  const [dandoAcceso, setDandoAcceso]         = useState(false);

  useEffect(() => { loadProveedores(); loadMarcas(); }, []);

  const loadMarcas = async () => {
    try {
      const r = await marcasVehiculoService.getAll();
      if (r.success && r.data) setMarcasPersistidas(r.data);
    } catch {}
  };

  // Lista completa: fijas del sistema + las que se han ido agregando y guardando
  const allMarcas = [
    ...MARCAS_VEHICULOS.filter(m => m !== 'OTRO'),
    ...marcasPersistidas.map(m => m.nombre).filter(n => !MARCAS_VEHICULOS.includes(n)),
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
    setModal(true);
  };

  const openEditar = (p: Proveedor) => {
    setEditingId(p.id!);
    const marcasConocidas = (p.marcas || []).filter(m => allMarcas.includes(m));
    const extra = (p.marcas || []).filter(m => !allMarcas.includes(m));
    setForm({
      nombre: p.nombre || '', rut: p.rut || '',
      contacto: p.contacto || '', telefono: p.telefono || '',
      email: p.email || '', direccion: p.direccion || '',
      categoria: p.categoria || 'General',
      marcas: marcasConocidas,
      notas: p.notas || '',
    });
    setMarcasExtra(extra);
    setMarcaCustom('');
    setModal(true);
  };

  const toggleMarca = (marca: string) => {
    const current = form.marcas || [];
    if (current.includes(marca)) {
      setForm(prev => ({ ...prev, marcas: current.filter(m => m !== marca) }));
    } else {
      setForm(prev => ({ ...prev, marcas: [...current, marca] }));
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
        // La dejamos seleccionada de una vez para este proveedor
        setForm(prev => ({ ...prev, marcas: [...(prev.marcas || []), m] }));
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
    setMarcasExtra(marcasExtra.filter(x => x !== m));
  };

  const abrirAcceso = (p: Proveedor) => {
    setAccesoProveedor(p);
    setAccesoPassword('');
    setAccesoModal(true);
  };

  const handleDarAcceso = async () => {
    if (!accesoProveedor?.id) return;
    if (!accesoProveedor.rut) { notify('Este proveedor necesita un RUT para poder tener acceso', 'error'); return; }
    if (accesoPassword.length < 6) { notify('La contraseña debe tener mínimo 6 caracteres', 'error'); return; }
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
    if (!form.nombre) { notify('Ingresa el nombre del proveedor', 'error'); return; }
    setLoading(true);
    try {
      const data = {
        ...form,
        marcas: [...(form.marcas || []), ...marcasExtra],
      };
      if (editingId) {
        await proveedoresService.update(editingId, data);
        notify('Proveedor actualizado ✓', 'success');
      } else {
        await proveedoresService.create(data);
        notify('Proveedor agregado ✓', 'success');
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

  const setField = (field: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const filtered = proveedores.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      p.nombre.toLowerCase().includes(q) ||
      (p.contacto || '').toLowerCase().includes(q) ||
      (p.rut || '').toLowerCase().includes(q) ||
      (p.marcas || []).some(m => m.toLowerCase().includes(q));
    const matchCat = !filtrocat || p.categoria === filtrocat;
    return matchSearch && matchCat;
  });
  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Proveedores</div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar proveedor, marca..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className={styles.filtroCategoria} value={filtrocat} onChange={e => setFiltrocat(e.target.value)}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
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
          <div className="stat-label">Total Proveedores</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {[...new Set(proveedores.map(p => p.categoria).filter(Boolean))].length}
          </div>
          <div className="stat-label">Categorías</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statConMarcas}`}>
            {proveedores.filter(p => (p.marcas || []).length > 0).length}
          </div>
          <div className="stat-label">Con Marcas</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${styles.statConEmail}`}>
            {proveedores.filter(p => p.email).length}
          </div>
          <div className="stat-label">Con Email</div>
        </div>
      </div>

      {/* ── TABLA ──────────────────────────────────────── */}
      <Pagination
        page={page} totalPages={totalPages} totalItems={filtered.length}
        pageSize={pageSize} onPage={goTo} onPageSize={changeSize}
      />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>RUT</th>
              <th>Categoría</th>
              <th>Marcas que Atiende</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.emptyRow}>
                  No hay proveedores registrados
                </td>
              </tr>
            )}
            {paged.map(p => (
              <tr key={p.id}>
                <td data-label="Nombre" className={styles.cellNombre}>{p.nombre}</td>
                <td data-label="RUT" className={styles.cellRut}>{p.rut || '—'}</td>
                <td data-label="Categoría">
                  <span className="badge badge-entregado">{p.categoria || '—'}</span>
                </td>
                <td data-label="Marcas que Atiende">
                  {(p.marcas || []).length > 0 ? (
                    <div className={styles.marcasRow}>
                      {(p.marcas || []).slice(0, 4).map(m => (
                        <span key={m} className={styles.badgeMarca}>
                          {m}
                        </span>
                      ))}
                      {(p.marcas || []).length > 4 && (
                        <span className={styles.badgeMore}>
                          +{(p.marcas || []).length - 4} más
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
                <td data-label="Contacto" className="hide-mobile">{p.contacto || '—'}</td>
                <td data-label="Teléfono" className="hide-mobile">{p.telefono || '—'}</td>
                <td data-label="Email" className="hide-mobile">{p.email || '—'}</td>
                <td data-label="Acciones">
                  <div className={styles.accionesCol}>
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
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MODAL ──────────────────────────────────────── */}
      {modal && (
        <div className="overlay open">
          <div className={`modal ${styles.modalProveedorForm}`}>
            <div className="modal-title">
              {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </div>

            {/* Datos básicos */}
            <div className="form-grid fg-2">
              <div className={`field ${styles.fullWidth}`}>
                <label>Nombre *</label>
                <input value={form.nombre} onChange={e => setField('nombre', e.target.value.toUpperCase())}
                  placeholder="Ej: BOSCH CHILE S.A." />
              </div>
              <div className="field">
                <label>RUT</label>
                <input value={form.rut} onChange={e => setField('rut', formatRut(e.target.value))}
                  placeholder="76.123.456-7" maxLength={12} />
              </div>
              <div className="field">
                <label>Categoría Principal</label>
                <select value={form.categoria} onChange={e => setField('categoria', e.target.value)}>
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Nombre Contacto</label>
                <input value={form.contacto} onChange={e => setField('contacto', e.target.value.toUpperCase())}
                  placeholder="NOMBRE DEL EJECUTIVO" />
              </div>
              <div className="field">
                <label>Teléfono</label>
                <input value={form.telefono}
                  onChange={e => { setField('telefono', e.target.value); setErrorTel(''); }}
                  onBlur={() => { if (form.telefono && !validarTelefonoChileno(form.telefono)) setErrorTel(errorTelefono); }}
                  placeholder="9 XXXX XXXX"
                  className={errorTel ? styles.inputError : ''} />
                {errorTel && <span className={styles.fieldError}>{errorTel}</span>}
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => setField('email', e.target.value)}
                  placeholder="ventas@proveedor.cl" />
              </div>
              <div className="field">
                <label>Dirección</label>
                <input value={form.direccion} onChange={e => setField('direccion', e.target.value)}
                  placeholder="Dirección comercial" />
              </div>
            </div>

            {/* Marcas */}
            <div className="modal-sep" />
            <div className={styles.sectionTitle}>
              <span className={styles.sectionTitleBar} />
              Marcas de Vehículos que Atiende
            </div>

            <div className={styles.marcasGrid}>
              {allMarcas.map(m => {
                const selected = (form.marcas || []).includes(m);
                return (
                  <button
                    key={m}
                    onClick={() => toggleMarca(m)}
                    className={`${styles.marcaToggle} ${selected ? styles.marcaToggleActive : ''}`}
                  >
                    {selected ? '✓ ' : ''}{m}
                  </button>
                );
              })}
            </div>

            {/* Marcas personalizadas */}
            {marcasExtra.length > 0 && (
              <div className={styles.marcasExtraRow}>
                {marcasExtra.map(m => (
                  <span key={m} className={styles.chipMarcaExtra}>
                    {m}
                    <span
                      className={styles.chipRemoveExtra}
                      onClick={() => removeMarcaExtra(m)}
                    >✕</span>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.customAddRow}>
              <input
                type="text"
                value={marcaCustom}
                onChange={e => setMarcaCustom(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && agregarMarcaCustom()}
                placeholder="Agregar marca no listada..."
                className={styles.flexInput}
              />
              <button
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
                  {(form.marcas || []).length + marcasExtra.length} marca(s) seleccionada(s):
                </strong>{' '}
                {[...(form.marcas || []), ...marcasExtra].join(', ')}
              </div>
            )}

            {/* Notas */}
            <div className="field">
              <label>Notas</label>
              <textarea value={form.notas} onChange={e => setField('notas', e.target.value)}
                rows={2} className={styles.textarea}
                placeholder="Condiciones comerciales, tiempo de entrega, etc..." />
            </div>

            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar</button>
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
                <> — accederá con su RUT y esta contraseña, y solo verá sus propios repuestos.</>
              )}
            </div>
            <div className="field">
              <label>{accesoProveedor.uid ? 'Nueva Contraseña' : 'Contraseña'}</label>
              <input
                type="text"
                value={accesoPassword}
                onChange={e => setAccesoPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => setAccesoModal(false)}>Cancelar</button>
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