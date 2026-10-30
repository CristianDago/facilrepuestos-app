import { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';
import type {
  ApiResponse,
  EscalamientoIA,
  ItemInventario,
  NodoAiloo,
  ReglaConocimientoAprendido,
  TipoAprendizajeIA,
} from '../../types';
import styles from './EscalamientosIA.module.css';

interface Props {
  modo?: 'admin' | 'proveedor';
}

export default function EscalamientosIA({ modo = 'admin' }: Props) {
  const { notify } = useAppStore();
  const esProveedor = modo === 'proveedor';

  const [tabActiva, setTabActiva] = useState<'escalamientos' | 'conocimiento'>('escalamientos');
  const [escalamientos, setEscalamientos] = useState<EscalamientoIA[]>([]);
  const [conocimiento, setConocimiento] = useState<ReglaConocimientoAprendido[]>([]);
  const [nodosAiloo, setNodosAiloo] = useState<NodoAiloo[]>([]);
  const [misRepuestos, setMisRepuestos] = useState<ItemInventario[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros de bandeja
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'respondido'>('pendiente');
  const [filtroOrigen, setFiltroOrigen] = useState<string>('todos');
  const [busquedaConocimiento, setBusquedaConocimiento] = useState('');

  // Escalamiento expandido para responder
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  const [formRespuesta, setFormRespuesta] = useState({
    respuestaMostrador: '',
    tipoAprendizaje: 'compatibilidad' as TipoAprendizajeIA,
    inventarioId: '',
    skuProveedor: '',
    nombreRepuesto: '',
    precioCostoProveedor: 0,
    marcaVehiculo: '',
    modeloVehiculo: '',
    anioDesde: '',
    anioHasta: '',
    motor: '',
    categoriaRepuesto: 'FRENOS',
    equivalenciaFabricante: '',
    equivalenciaCodigo: '',
    actualizarFichaInventario: true,
    guardarConocimiento: true,
  });
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);

  // Modal / Panel de Crear / Simular Escalamiento (Admin)
  const [mostrarNuevoModal, setMostrarNuevoModal] = useState(false);
  const [nuevoEsc, setNuevoEsc] = useState({
    canalOrigen: 'whatsapp' as 'whatsapp' | 'web',
    destinoSelector: 'soluparts', // 'soluparts' | 'global' | 'prov-demo-001'
    patente: 'JPKR42',
    marcaVehiculo: 'HYUNDAI',
    modeloVehiculo: 'PORTER',
    anioVehiculo: '2018',
    motorVehiculo: '2.5 D4CB CRDI',
    mensajeCliente: 'Necesito kit de embrague para Hyundai Porter 2.5 2018 caja sexta, ¿le sirve el de 240mm o lleva bimasa?',
    motivoEscalamiento: 'Confirmar diámetro de disco (240mm vs 250mm) y volante para Porter 2.5 D4CB 2018 caja 6 velocidades',
    transcripcionAudio: '',
    candidatoCodigo: 'SOL-78120',
    candidatoNombre: 'KIT EMBRAGUE HYUNDAI H100 / PORTER 2.5 CRDI',
    prioridad: 'alta' as 'alta' | 'media' | 'baja',
  });

  // Edición de márgenes de Nodos Ailoo
  const [margenesEdit, setMargenesEdit] = useState<Record<string, number>>({});
  const [sincronizandoNodo, setSincronizandoNodo] = useState<string | null>(null);

  const cargarTodo = async () => {
    try {
      setLoading(true);
      const promesas: Promise<unknown>[] = [
        api.get<ApiResponse<EscalamientoIA[]>>('/escalamientos'),
        api.get<ApiResponse<ReglaConocimientoAprendido[]>>(
          `/escalamientos/conocimiento${esProveedor ? '?soloMias=false' : ''}`
        ),
        api.get<ApiResponse<ItemInventario[]>>('/inventario'),
      ];
      if (!esProveedor) {
        promesas.push(api.get<ApiResponse<NodoAiloo[]>>('/escalamientos/nodos'));
      }

      const [escRes, knowRes, invRes, nodosRes] = (await Promise.all(promesas)) as [
        ApiResponse<EscalamientoIA[]>,
        ApiResponse<ReglaConocimientoAprendido[]>,
        ApiResponse<ItemInventario[]>,
        ApiResponse<NodoAiloo[]> | undefined
      ];

      if (escRes.success && escRes.data) setEscalamientos(escRes.data);
      if (knowRes.success && knowRes.data) setConocimiento(knowRes.data);
      if (invRes.success && invRes.data) setMisRepuestos(invRes.data);
      if (nodosRes?.success && nodosRes.data) {
        setNodosAiloo(nodosRes.data);
        const mapMargen: Record<string, number> = {};
        nodosRes.data.forEach((n) => {
          mapMargen[n.id] = n.margenPct;
        });
        setMargenesEdit(mapMargen);
      }
    } catch (err) {
      notify((err as Error).message || 'Error al cargar escalamientos IA', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarTodo();
  }, [modo]);

  const abrirPanelRespuesta = (esc: EscalamientoIA) => {
    if (respondiendoId === esc.id) {
      setRespondiendoId(null);
      return;
    }
    const itemCandidato = misRepuestos.find((i) => i.id === esc.candidatoInventarioId);
    setRespondiendoId(esc.id);
    setFormRespuesta({
      respuestaMostrador: '',
      tipoAprendizaje: 'compatibilidad',
      inventarioId: esc.candidatoInventarioId || '',
      skuProveedor: itemCandidato?.codigo || esc.candidatoCodigo || '',
      nombreRepuesto: itemCandidato?.nombre || esc.candidatoNombre || '',
      precioCostoProveedor: itemCandidato?.precioCompra || itemCandidato?.precioLista || 25000,
      marcaVehiculo: esc.marcaVehiculo || '',
      modeloVehiculo: esc.modeloVehiculo || '',
      anioDesde: esc.anioVehiculo ? String(esc.anioVehiculo - 2) : '2016',
      anioHasta: esc.anioVehiculo ? String(esc.anioVehiculo + 2) : '2021',
      motor: esc.motorVehiculo || '',
      categoriaRepuesto: itemCandidato?.categoria || 'FRENOS',
      equivalenciaFabricante: '',
      equivalenciaCodigo: '',
      actualizarFichaInventario: Boolean(esc.candidatoInventarioId || esProveedor),
      guardarConocimiento: true,
    });
  };

  const handleSeleccionarInventario = (invId: string) => {
    const item = misRepuestos.find((i) => i.id === invId);
    if (!item) {
      setFormRespuesta((prev) => ({ ...prev, inventarioId: '' }));
      return;
    }
    setFormRespuesta((prev) => ({
      ...prev,
      inventarioId: item.id || '',
      skuProveedor: item.codigo,
      nombreRepuesto: item.nombre,
      precioCostoProveedor: item.precioCompra || item.precioLista || prev.precioCostoProveedor,
      categoriaRepuesto: item.categoria || prev.categoriaRepuesto,
    }));
  };

  const handleEnviarRespuesta = async (escId: string) => {
    if (!formRespuesta.respuestaMostrador.trim()) {
      notify('Escribe la validación o respuesta técnica antes de confirmar', 'error');
      return;
    }
    try {
      setEnviandoRespuesta(true);
      const res = await api.post<
        ApiResponse<{
          escalamiento: EscalamientoIA;
          reglaConocimiento: ReglaConocimientoAprendido | null;
          inventarioActualizado: boolean;
        }>
      >(`/escalamientos/${escId}/responder`, {
        ...formRespuesta,
        anioDesde: formRespuesta.anioDesde ? Number(formRespuesta.anioDesde) : null,
        anioHasta: formRespuesta.anioHasta ? Number(formRespuesta.anioHasta) : null,
        precioCostoProveedor: Number(formRespuesta.precioCostoProveedor) || 0,
      });

      if (res.success && res.data) {
        const msgExtra = res.data.inventarioActualizado
          ? ' + Ficha de inventario actualizada con la compatibilidad'
          : '';
        notify(
          `✓ Respuesta validada, conocimiento aprendido guardado${msgExtra}`,
          'success'
        );
        setRespondiendoId(null);
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al responder escalamiento', 'error');
    } finally {
      setEnviandoRespuesta(false);
    }
  };

  const handleGuardarMargenNodo = async (nodoId: string) => {
    try {
      const nuevoMargen = Number(margenesEdit[nodoId]) || 0;
      const res = await api.put<ApiResponse<NodoAiloo>>(`/escalamientos/nodos/${nodoId}`, {
        margenPct: nuevoMargen,
      });
      if (res.success) {
        notify(`✓ Margen comercial de ${nodoId.toUpperCase()} actualizado a +${nuevoMargen}%`, 'success');
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const handleSincronizarNodoAiloo = async (nodo: NodoAiloo) => {
    try {
      setSincronizandoNodo(nodo.id);
      const res = await api.post<
        ApiResponse<{
          nodoId: string;
          dataset: string;
          sincronizados: number;
        }>
      >(`/escalamientos/nodos/${nodo.id}/sync`, {});

      if (res.success && res.data) {
        if (res.data.sincronizados > 0) {
          notify(
            `✓ Sincronizados ${res.data.sincronizados} escalamiento(s) y reglas desde ${res.data.dataset}`,
            'success'
          );
        } else {
          notify(
            `ℹ Sincronización con ${res.data.dataset} al día (sin nuevos tickets pendientes)`,
            'info'
          );
        }
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al sincronizar nodo Ailoo', 'error');
    } finally {
      setSincronizandoNodo(null);
    }
  };

  const handleCrearEscalamiento = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const esAiloo =
        nuevoEsc.destinoSelector === 'soluparts' || nuevoEsc.destinoSelector === 'global';
      const payload = {
        canalOrigen: nuevoEsc.canalOrigen,
        tipoDestino: esAiloo ? 'nodo_ailoo' : 'proveedor_local',
        proveedorId: nuevoEsc.destinoSelector,
        proveedorNombre:
          nuevoEsc.destinoSelector === 'soluparts'
            ? 'Soluparts'
            : nuevoEsc.destinoSelector === 'global'
            ? 'Global Repuestos'
            : 'Proveedor Demo',
        nodoAilooId: esAiloo ? nuevoEsc.destinoSelector : null,
        patente: nuevoEsc.patente,
        marcaVehiculo: nuevoEsc.marcaVehiculo,
        modeloVehiculo: nuevoEsc.modeloVehiculo,
        anioVehiculo: nuevoEsc.anioVehiculo ? Number(nuevoEsc.anioVehiculo) : null,
        motorVehiculo: nuevoEsc.motorVehiculo,
        mensajeCliente: nuevoEsc.mensajeCliente,
        motivoEscalamiento: nuevoEsc.motivoEscalamiento,
        transcripcionAudio: nuevoEsc.transcripcionAudio,
        candidatoCodigo: nuevoEsc.candidatoCodigo,
        candidatoNombre: nuevoEsc.candidatoNombre,
        prioridad: nuevoEsc.prioridad,
      };

      const res = await api.post<ApiResponse<EscalamientoIA>>('/escalamientos', payload);
      if (res.success && res.data) {
        const destMsg =
          res.data.tipoDestino === 'nodo_ailoo'
            ? `federado hacia ${res.data.datasetDestino}`
            : `enviado al Portal de ${res.data.proveedorNombre}`;
        notify(`✓ Ticket ${res.data.ticketRef} creado y ${destMsg}`, 'success');
        setMostrarNuevoModal(false);
        setFiltroEstado('pendiente');
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  // Filtrado de escalamientos
  const escalamientosFiltrados = useMemo(() => {
    return escalamientos.filter((e) => {
      if (filtroEstado !== 'todos' && e.estado !== filtroEstado) return false;
      if (!esProveedor && filtroOrigen !== 'todos') {
        if (filtroOrigen === 'local' && e.tipoDestino !== 'proveedor_local') return false;
        if (filtroOrigen === 'soluparts' && e.nodoAilooId !== 'soluparts') return false;
        if (filtroOrigen === 'global' && e.nodoAilooId !== 'global') return false;
      }
      return true;
    });
  }, [escalamientos, filtroEstado, filtroOrigen, esProveedor]);

  // Filtrado de conocimiento aprendido
  const conocimientoFiltrado = useMemo(() => {
    const q = busquedaConocimiento.trim().toLowerCase();
    return conocimiento.filter((k) => {
      if (!esProveedor && filtroOrigen !== 'todos') {
        if (filtroOrigen === 'local' && k.origenTipo !== 'proveedor_local') return false;
        if (filtroOrigen === 'soluparts' && k.nodoAilooId !== 'soluparts') return false;
        if (filtroOrigen === 'global' && k.nodoAilooId !== 'global') return false;
      }
      if (!q) return true;
      const texto = [
        k.marcaVehiculo,
        k.modeloVehiculo,
        k.motor,
        k.skuProveedor,
        k.skuPublicoFrp,
        k.preguntaResumen,
        k.respuestaValidada,
        k.terminosClave,
        k.proveedorNombre,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return texto.includes(q);
    });
  }, [conocimiento, busquedaConocimiento, filtroOrigen, esProveedor]);

  const totalPendientes = escalamientos.filter((e) => e.estado === 'pendiente').length;
  const totalRespondidos = escalamientos.filter((e) => e.estado === 'respondido').length;

  return (
    <div className={styles.container}>
      {/* Cabecera */}
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>
            🧠{' '}
            {esProveedor
              ? 'Mostrador IA: Consultas Técnicas y Aprendizaje'
              : 'Centro de Escalamiento Federado y Conocimiento IA'}
          </h1>
          <p className={styles.subtitle}>
            {esProveedor
              ? 'Responde dudas técnicas de compatibilidad de tus repuestos. Cada respuesta enseña al Agente IA y actualiza tus fichas automáticamente.'
              : 'Conecta el Agente de FácilRepuestos con soluparts_ailoo.escalamientos, global_ailoo.escalamientos y el Portal de Proveedores Locales.'}
          </p>
        </div>

        {!esProveedor && (
          <button
            className="btn btn-primary"
            onClick={() => setMostrarNuevoModal((v) => !v)}
          >
            {mostrarNuevoModal ? '✕ Cerrar Simulador' : '+ Derivar / Simular Escalamiento IA'}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Consultas Pendientes (SLA)</div>
          <div className={styles.kpiValue} style={{ color: totalPendientes > 0 ? '#d97706' : '#10b981' }}>
            {totalPendientes}
          </div>
          <div className={styles.kpiSub}>
            {esProveedor
              ? 'Esperando validación de tu mostrador'
              : 'En cola entre Nodos Ailoo y Proveedores Locales'}
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Consultas Resueltas</div>
          <div className={styles.kpiValue} style={{ color: '#059669' }}>
            {totalRespondidos}
          </div>
          <div className={styles.kpiSub}>Con margen FácilRepuestos y SKU público</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Base Conocimiento Aprendido</div>
          <div className={styles.kpiValue} style={{ color: '#2563eb' }}>
            {conocimiento.length}
          </div>
          <div className={styles.kpiSub}>Reglas técnicas que la IA ya responde sola</div>
        </div>
      </div>

      {/* Sección Nodos Ailoo Federados (Solo Admin) */}
      {!esProveedor && nodosAiloo.length > 0 && (
        <div className={styles.nodosSection}>
          <div className={styles.nodosHeader}>
            <div>
              <h2 className={styles.nodosTitle}>
                🔗 Nodos Enterprise Ailoo Conectados (Puente BigQuery + Portal Mostrador)
              </h2>
              <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 2 }}>
                Las dudas de compatibilidad caen en el portal de cada proveedor (`{'{nodo}'}_ailoo.escalamientos`) y vuelven a FácilRepuestos con margen aplicado.
              </div>
            </div>
          </div>

          <div className={styles.nodosGrid}>
            {nodosAiloo.map((nodo) => {
              const pendNodo = escalamientos.filter(
                (e) => e.nodoAilooId === nodo.id && e.estado === 'pendiente'
              ).length;
              const knowNodo = conocimiento.filter((k) => k.nodoAilooId === nodo.id).length;

              return (
                <div key={nodo.id} className={styles.nodoCard}>
                  <div className={styles.nodoTop}>
                    <span className={styles.nodoName}>🏢 {nodo.nombre}</span>
                    <span className={styles.datasetBadge}>
                      {nodo.datasetId}.{nodo.tablaEscalamientos}
                    </span>
                  </div>

                  <div className={styles.nodoMetaRow}>
                    <span>
                      Prefijo SKU: <strong>{nodo.prefijoSku}-*</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Pendientes en su portal: <strong>{pendNodo}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Reglas aprendidas: <strong>{knowNodo}</strong>
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginTop: 4,
                    }}
                  >
                    <div className={styles.margenInputGroup}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Margen FRP %:</span>
                      <input
                        type="number"
                        className={styles.margenInput}
                        value={margenesEdit[nodo.id] ?? nodo.margenPct}
                        onChange={(e) =>
                          setMargenesEdit((prev) => ({
                            ...prev,
                            [nodo.id]: Number(e.target.value),
                          }))
                        }
                      />
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleGuardarMargenNodo(nodo.id)}
                      >
                        Guardar %
                      </button>
                    </div>

                    <button
                      className="btn btn-sm btn-primary"
                      disabled={sincronizandoNodo === nodo.id}
                      onClick={() => handleSincronizarNodoAiloo(nodo)}
                    >
                      {sincronizandoNodo === nodo.id
                        ? 'Sincronizando...'
                        : `🔄 Sincronizar ${nodo.datasetId}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal / Formulario para Simular o Derivar un nuevo Escalamiento (Admin) */}
      {!esProveedor && mostrarNuevoModal && (
        <form onSubmit={handleCrearEscalamiento} className={styles.replyPanel}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
            🚀 Derivar / Simular Escalamiento Técnico del Agente IA
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Derivar Hacia (Nodo / Portal)</label>
              <select
                className={styles.select}
                value={nuevoEsc.destinoSelector}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, destinoSelector: e.target.value }))
                }
              >
                <option value="soluparts">🔵 Portal Soluparts (soluparts_ailoo.escalamientos)</option>
                <option value="global">🟣 Portal Global (global_ailoo.escalamientos)</option>
                <option value="prov-demo-001">🟢 Proveedor Demo (Portal Proveedor Local FRP)</option>
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Patente (Boostr)</label>
              <input
                className={styles.input}
                value={nuevoEsc.patente}
                onChange={(e) => setNuevoEsc((prev) => ({ ...prev, patente: e.target.value }))}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Marca Vehículo</label>
              <input
                className={styles.input}
                value={nuevoEsc.marcaVehiculo}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, marcaVehiculo: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Modelo Vehículo</label>
              <input
                className={styles.input}
                value={nuevoEsc.modeloVehiculo}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, modeloVehiculo: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Año</label>
              <input
                type="number"
                className={styles.input}
                value={nuevoEsc.anioVehiculo}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, anioVehiculo: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Motor / Versión</label>
              <input
                className={styles.input}
                value={nuevoEsc.motorVehiculo}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, motorVehiculo: e.target.value }))
                }
              />
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Pregunta del Cliente Final</label>
              <textarea
                className={styles.textarea}
                value={nuevoEsc.mensajeCliente}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, mensajeCliente: e.target.value }))
                }
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Motivo Técnico de Escalamiento (`[ESCALAR: ...]`) </label>
              <textarea
                className={styles.textarea}
                value={nuevoEsc.motivoEscalamiento}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, motivoEscalamiento: e.target.value }))
                }
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setMostrarNuevoModal(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Enviar a Cola de Escalamiento
            </button>
          </div>
        </form>
      )}

      {/* Pestañas principales */}
      <div className={styles.tabsBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${
            tabActiva === 'escalamientos' ? styles.tabBtnActive : ''
          }`}
          onClick={() => setTabActiva('escalamientos')}
        >
          📬 Bandeja de Escalamientos ({escalamientos.length})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${
            tabActiva === 'conocimiento' ? styles.tabBtnActive : ''
          }`}
          onClick={() => setTabActiva('conocimiento')}
        >
          📚 Conocimiento Aprendido ({conocimiento.length})
        </button>
      </div>

      {/* Filtros combinables */}
      <div className={styles.filtersRow}>
        {tabActiva === 'escalamientos' ? (
          <div className={styles.pillGroup}>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroEstado === 'pendiente' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroEstado('pendiente')}
            >
              ⏳ Pendientes ({totalPendientes})
            </button>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroEstado === 'respondido' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroEstado('respondido')}
            >
              ✅ Respondidos ({totalRespondidos})
            </button>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroEstado === 'todos' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroEstado('todos')}
            >
              Todos ({escalamientos.length})
            </button>
          </div>
        ) : (
          <input
            className={styles.input}
            style={{ minWidth: 300 }}
            placeholder="🔍 Buscar en conocimiento aprendido por marca, modelo, motor, SKU..."
            value={busquedaConocimiento}
            onChange={(e) => setBusquedaConocimiento(e.target.value)}
          />
        )}

        {!esProveedor && (
          <div className={styles.pillGroup}>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroOrigen === 'todos' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroOrigen('todos')}
            >
              Todos los Nodos
            </button>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroOrigen === 'soluparts' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroOrigen('soluparts')}
            >
              🔵 soluparts_ailoo
            </button>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroOrigen === 'global' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroOrigen('global')}
            >
              🟣 global_ailoo
            </button>
            <button
              type="button"
              className={`${styles.pillBtn} ${
                filtroOrigen === 'local' ? styles.pillBtnActive : ''
              }`}
              onClick={() => setFiltroOrigen('local')}
            >
              🟢 Proveedores Locales
            </button>
          </div>
        )}
      </div>

      {/* CONTENIDO PESTAÑA 1: BANDEJA DE ESCALAMIENTOS */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          Cargando escalamientos y base de conocimiento...
        </div>
      ) : tabActiva === 'escalamientos' ? (
        escalamientosFiltrados.length === 0 ? (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              color: '#64748b',
            }}
          >
            No hay consultas en este estado.
          </div>
        ) : (
          <div className={styles.cardsList}>
            {escalamientosFiltrados.map((esc) => {
              const abierto = respondiendoId === esc.id;
              return (
                <div
                  key={esc.id}
                  className={`${styles.escCard} ${
                    esc.estado === 'respondido' ? styles.escCardRespondido : ''
                  }`}
                >
                  <div className={styles.escHeader}>
                    <div className={styles.escBadges}>
                      <span className={styles.ticketRef}>{esc.ticketRef}</span>
                      {esc.tipoDestino === 'nodo_ailoo' ? (
                        <span className={styles.destinoBadgeAiloo}>
                          🔗 Federado en {esc.datasetDestino || `${esc.nodoAilooId}_ailoo.escalamientos`}
                        </span>
                      ) : (
                        <span className={styles.destinoBadgeLocal}>
                          🏭 Portal Proveedor: {esc.proveedorNombre}
                        </span>
                      )}
                      <span
                        className={
                          esc.estado === 'respondido'
                            ? styles.estadoBadgeRespondido
                            : styles.estadoBadgePendiente
                        }
                      >
                        {esc.estado === 'respondido' ? '✅ RESPONDIDO' : '⏳ PENDIENTE'}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Canal: {esc.canalOrigen.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {new Date(esc.creadoEn).toLocaleString('es-CL')}
                    </div>
                  </div>

                  {/* Barra de Vehículo Detectado */}
                  <div className={styles.vehiculoBar}>
                    {esc.patente && <span className={styles.patenteTag}>{esc.patente}</span>}
                    <span className={styles.vehiculoInfo}>
                      🚗 {esc.marcaVehiculo} {esc.modeloVehiculo}{' '}
                      {esc.anioVehiculo ? `· Año ${esc.anioVehiculo}` : ''}
                    </span>
                    {esc.motorVehiculo && (
                      <span style={{ fontSize: '0.84rem', color: '#334155', fontWeight: 600 }}>
                        ⚙️ Motor: {esc.motorVehiculo}
                      </span>
                    )}
                    {esc.vinVehiculo && (
                      <span style={{ fontSize: '0.78rem', color: '#64748b', fontFamily: 'monospace' }}>
                        VIN: {esc.vinVehiculo}
                      </span>
                    )}
                  </div>

                  {/* Consulta del Cliente y Audio Transcrito */}
                  <div className={styles.mensajeBox}>
                    <div className={styles.mensajeLabel}>Consulta del Cliente Final</div>
                    <p className={styles.mensajeText}>"{esc.mensajeCliente}"</p>
                    {esc.transcripcionAudio && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: '1px dashed #fcd34d',
                          fontSize: '0.84rem',
                          color: '#78350f',
                        }}
                      >
                        🎙️ <strong>Audio transcrito (Gemini 2.5 Flash):</strong> "{esc.transcripcionAudio}"
                      </div>
                    )}
                  </div>

                  {/* Motivo técnico de escalamiento y SKU candidato */}
                  <div className={styles.motivoBox}>
                    <div>
                      <strong>🤖 Motivo de Escalamiento IA:</strong> {esc.motivoEscalamiento}
                    </div>
                    {(esc.candidatoCodigo || esc.candidatoNombre) && (
                      <div style={{ marginTop: 4 }}>
                        <strong>📦 Repuesto Candidato:</strong> {esc.candidatoCodigo} —{' '}
                        {esc.candidatoNombre}
                      </div>
                    )}
                  </div>

                  {/* Si ya fue respondido: muestra la respuesta técnica y el cálculo comercial */}
                  {esc.estado === 'respondido' && (
                    <div className={styles.respuestaBox}>
                      <div style={{ fontSize: '0.85rem', color: '#065f46' }}>
                        <strong>✓ Respuesta de Mostrador ({esc.respondidoPor}):</strong>{' '}
                        {esc.respuestaMostrador}
                      </div>

                      <div className={styles.comercialBar}>
                        <span>
                          <strong>SKU Público FRP:</strong>{' '}
                          <code>{esc.skuPublicoFrp || 'N/A'}</code>
                        </span>
                        <span>
                          <strong>Costo Proveedor:</strong> $
                          {(esc.precioCostoProveedor || 0).toLocaleString('es-CL')} neto
                        </span>
                        {!esProveedor && (
                          <>
                            <span>
                              <strong>Margen FácilRepuestos:</strong> +{esc.margenAplicadoPct || 0}%
                            </span>
                            <span style={{ color: '#047857', fontWeight: 800 }}>
                              <strong>Precio Venta Cliente FRP:</strong> $
                              {(esc.precioVentaFrp || 0).toLocaleString('es-CL')} neto ($
                              {Math.round((esc.precioVentaFrp || 0) * 1.19).toLocaleString('es-CL')}{' '}
                              IVA inc.)
                            </span>
                          </>
                        )}
                      </div>

                      {!esProveedor && esc.mensajeFinalCliente && (
                        <div style={{ fontSize: '0.82rem', color: '#047857' }}>
                          <strong>📲 Mensaje enviado al cliente por FácilRepuestos:</strong>{' '}
                          "{esc.mensajeFinalCliente}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* Acciones si está pendiente */}
                  {esc.estado === 'pendiente' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => abrirPanelRespuesta(esc)}
                      >
                        {abierto
                          ? 'Cerrar Panel de Respuesta'
                          : '✍️ Responder Consulta y Guardar en Conocimiento Aprendido'}
                      </button>
                    </div>
                  )}

                  {/* Panel desplegable de Respuesta Experta y Aprendizaje */}
                  {abierto && (
                    <div className={styles.replyPanel}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>
                        ✍️ Validación Técnica de Mostrador + Enseñanza a la IA
                      </div>

                      {/* 1. Vincular con repuesto del inventario */}
                      <div className={styles.formGrid}>
                        <div className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
                          <label className={styles.fieldLabel}>
                            1. Vincular Repuesto de mi Inventario (Opcional)
                          </label>
                          <select
                            className={styles.select}
                            value={formRespuesta.inventarioId}
                            onChange={(e) => handleSeleccionarInventario(e.target.value)}
                          >
                            <option value="">-- Seleccionar repuesto del inventario --</option>
                            {misRepuestos.map((item) => (
                              <option key={item.id} value={item.id}>
                                [{item.codigo}] {item.nombre} · Stock: {item.stock} · Costo: $
                                {(item.precioCompra || 0).toLocaleString('es-CL')}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Código / SKU Proveedor</label>
                          <input
                            className={styles.input}
                            value={formRespuesta.skuProveedor}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                skuProveedor: e.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Precio Costo Neto ($ CLP)</label>
                          <input
                            type="number"
                            className={styles.input}
                            value={formRespuesta.precioCostoProveedor}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                precioCostoProveedor: Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                      </div>

                      {/* 2. Respuesta técnica */}
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>
                          2. Respuesta Técnica Experta (Explicación de compatibilidad / calce)
                        </label>
                        <textarea
                          className={styles.textarea}
                          placeholder="Ej: Sí, las pastillas Bosch 0986424792 calzan exacto en el Toyota Yaris 1.5 motor 2NR-FE entre 2016 y 2021."
                          value={formRespuesta.respuestaMostrador}
                          onChange={(e) =>
                            setFormRespuesta((prev) => ({
                              ...prev,
                              respuestaMostrador: e.target.value,
                            }))
                          }
                        />
                      </div>

                      {/* 3. Regla estructurada para Conocimiento Aprendido */}
                      <div className={styles.formGrid}>
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Tipo de Aprendizaje IA</label>
                          <select
                            className={styles.select}
                            value={formRespuesta.tipoAprendizaje}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                tipoAprendizaje: e.target.value as TipoAprendizajeIA,
                              }))
                            }
                          >
                            <option value="compatibilidad">✅ Compatibilidad Confirmada</option>
                            <option value="equivalencia">🔄 Equivalencia OEM / Cruce</option>
                            <option value="correccion_catalogo">🔧 Corrección de Años / Motor</option>
                            <option value="disponibilidad_precio">💲 Cotización y Disponibilidad</option>
                          </select>
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Marca Vehículo Compatible</label>
                          <input
                            className={styles.input}
                            value={formRespuesta.marcaVehiculo}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                marcaVehiculo: e.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Modelo Vehículo Compatible</label>
                          <input
                            className={styles.input}
                            value={formRespuesta.modeloVehiculo}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                modeloVehiculo: e.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Año Desde</label>
                          <input
                            type="number"
                            className={styles.input}
                            value={formRespuesta.anioDesde}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                anioDesde: e.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Año Hasta</label>
                          <input
                            type="number"
                            className={styles.input}
                            value={formRespuesta.anioHasta}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                anioHasta: e.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Motor / Especificación</label>
                          <input
                            className={styles.input}
                            value={formRespuesta.motor}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                motor: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>

                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={formRespuesta.guardarConocimiento}
                          onChange={(e) =>
                            setFormRespuesta((prev) => ({
                              ...prev,
                              guardarConocimiento: e.target.checked,
                            }))
                          }
                        />
                        🧠 Guardar regla en Base de Conocimiento Aprendido (el Agente IA responderá solo la próxima vez)
                      </label>

                      {formRespuesta.inventarioId && (
                        <label className={styles.checkboxRow}>
                          <input
                            type="checkbox"
                            checked={formRespuesta.actualizarFichaInventario}
                            onChange={(e) =>
                              setFormRespuesta((prev) => ({
                                ...prev,
                                actualizarFichaInventario: e.target.checked,
                              }))
                            }
                          />
                          📦 Enriquecer automáticamente mi ficha en Inventario con esta Marca, Modelo y Rango de Años
                        </label>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setRespondiendoId(null)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={enviandoRespuesta}
                          onClick={() => handleEnviarRespuesta(esc.id)}
                        >
                          {enviandoRespuesta
                            ? 'Guardando...'
                            : '✅ Confirmar Respuesta y Enseñar a la IA'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* CONTENIDO PESTAÑA 2: BASE DE CONOCIMIENTO APRENDIDO */
        <div className={styles.knowGrid}>
          {conocimientoFiltrado.map((k) => (
            <div key={k.id} className={styles.knowCard}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span className={styles.datasetBadge}>
                  {k.datasetOrigen || 'conocimiento_aprendido'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {new Date(k.creadoEn).toLocaleDateString('es-CL')}
                </span>
              </div>

              <div style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f172a' }}>
                {k.preguntaResumen}
              </div>

              <div style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.45 }}>
                {k.respuestaValidada}
              </div>

              <div className={styles.knowTags}>
                {k.marcaVehiculo && (
                  <span className={styles.knowTag}>
                    🚗 {k.marcaVehiculo} {k.modeloVehiculo}
                  </span>
                )}
                {(k.anioDesde || k.anioHasta) && (
                  <span className={styles.knowTag}>
                    📅 {k.anioDesde || '?'}–{k.anioHasta || '?'}
                  </span>
                )}
                {k.motor && <span className={styles.knowTag}>⚙️ {k.motor}</span>}
                {k.skuPublicoFrp && (
                  <span className={styles.knowTag}>🏷️ {k.skuPublicoFrp}</span>
                )}
              </div>

              <div
                style={{
                  fontSize: '0.76rem',
                  color: '#64748b',
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: 8,
                }}
              >
                Validado por: <strong>{k.validadoPor}</strong> · Palabras clave:{' '}
                <code>{k.terminosClave}</code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
