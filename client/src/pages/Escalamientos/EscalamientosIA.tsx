import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import {
  woocommerceService,
  type EstadoColaWooCommerce,
} from '../../services/woocommerce';
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
  const navigate = useNavigate();
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

  // Escalamiento expandido para configuración avanzada de ficha/inventario
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  // Borradores inline por cada tarjeta (estilo portal.soluparts.cl/escalamiento)
  const [respuestasInline, setRespuestasInline] = useState<Record<string, string>>({});
  const [enviandoInlineId, setEnviandoInlineId] = useState<string | null>(null);
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
    imagenUrl: '',
    candidatoCodigo: 'SOL-78120',
    candidatoNombre: 'KIT EMBRAGUE HYUNDAI H100 / PORTER 2.5 CRDI',
    prioridad: 'alta' as 'alta' | 'media' | 'baja',
  });

  // Edición de márgenes de Nodos Ailoo y Sincronización de Catálogo + WooCommerce Delta
  const [margenesEdit, setMargenesEdit] = useState<Record<string, number>>({});
  const [sincronizandoNodo, setSincronizandoNodo] = useState<string | null>(null);
  const [sincronizandoCatalogoNodo, setSincronizandoCatalogoNodo] = useState<string | null>(null);
  const [sincronizandoTodosCatalogos, setSincronizandoTodosCatalogos] = useState(false);
  const [sincronizandoWooDelta, setSincronizandoWooDelta] = useState(false);
  const [estadoWoo, setEstadoWoo] = useState<EstadoColaWooCommerce | null>(null);

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
        promesas.push(woocommerceService.getStatus().catch(() => null));
      }

      const [escRes, knowRes, invRes, nodosRes, wooRes] = (await Promise.all(promesas)) as [
        ApiResponse<EscalamientoIA[]>,
        ApiResponse<ReglaConocimientoAprendido[]>,
        ApiResponse<ItemInventario[]>,
        ApiResponse<NodoAiloo[]> | undefined,
        ApiResponse<EstadoColaWooCommerce> | null | undefined
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
      if (wooRes?.success && wooRes.data) {
        setEstadoWoo(wooRes.data);
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

  const handleEnviarRespuesta = async (esc: EscalamientoIA, textoOverride?: string) => {
    const escId = esc.id;
    const textoFinal = (
      textoOverride ??
      respuestasInline[escId] ??
      (respondiendoId === escId ? formRespuesta.respuestaMostrador : '')
    ).trim();

    if (!textoFinal) {
      notify('Escribe la validación o respuesta técnica antes de confirmar', 'error');
      return;
    }
    try {
      setEnviandoRespuesta(true);
      setEnviandoInlineId(escId);
      const itemCandidato = misRepuestos.find((i) => i.id === esc.candidatoInventarioId);
      const usandoAvanzado = respondiendoId === escId;

      const payload = usandoAvanzado
        ? {
            ...formRespuesta,
            respuestaMostrador: textoFinal,
            anioDesde: formRespuesta.anioDesde ? Number(formRespuesta.anioDesde) : null,
            anioHasta: formRespuesta.anioHasta ? Number(formRespuesta.anioHasta) : null,
            precioCostoProveedor: Number(formRespuesta.precioCostoProveedor) || 0,
          }
        : {
            respuestaMostrador: textoFinal,
            tipoAprendizaje: 'compatibilidad' as TipoAprendizajeIA,
            inventarioId: esc.candidatoInventarioId || '',
            skuProveedor: itemCandidato?.codigo || esc.candidatoCodigo || '',
            nombreRepuesto: itemCandidato?.nombre || esc.candidatoNombre || '',
            precioCostoProveedor:
              itemCandidato?.precioCompra ||
              itemCandidato?.precioLista ||
              esc.precioCostoProveedor ||
              25000,
            marcaVehiculo: esc.marcaVehiculo || '',
            modeloVehiculo: esc.modeloVehiculo || '',
            anioDesde: esc.anioVehiculo ? Number(esc.anioVehiculo) - 2 : null,
            anioHasta: esc.anioVehiculo ? Number(esc.anioVehiculo) + 2 : null,
            motor: esc.motorVehiculo || '',
            categoriaRepuesto: itemCandidato?.categoria || 'MOTOR',
            actualizarFichaInventario: Boolean(esc.candidatoInventarioId || esProveedor),
            guardarConocimiento: true,
          };

      const res = await api.post<
        ApiResponse<{
          escalamiento: EscalamientoIA;
          reglaConocimiento: ReglaConocimientoAprendido | null;
          inventarioActualizado: boolean;
          envioWhatsapp?: {
            enviado?: boolean;
            dentroVentana24h?: boolean;
            horasTranscurridas?: number;
          } | null;
        }>
      >(`/escalamientos/${escId}/responder`, payload);

      if (res.success && res.data) {
        const msgExtra = res.data.inventarioActualizado
          ? ' + Ficha de inventario actualizada'
          : '';
        const wspStatus =
          res.data.envioWhatsapp?.dentroVentana24h === false
            ? ' (guardada en el chat; consulta > 24h)'
            : ' y enviada por push directo al WhatsApp del cliente (< 24h)';
        notify(
          `✓ Respuesta validada${wspStatus}${msgExtra}`,
          'success'
        );
        setRespondiendoId(null);
        setRespuestasInline((prev) => {
          const next = { ...prev };
          delete next[escId];
          return next;
        });
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al responder escalamiento', 'error');
    } finally {
      setEnviandoRespuesta(false);
      setEnviandoInlineId(null);
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

  const handleSincronizarCatalogoNodoAiloo = async (nodo: NodoAiloo) => {
    try {
      setSincronizandoCatalogoNodo(nodo.id);
      const res = await woocommerceService.syncAilooNodo(nodo.id, { forzar: false });
      if (res.success && res.data?.ingesta) {
        const { nuevos, actualizados, sinCambiosOmitidos, totalLeidos } = res.data.ingesta;
        if (nuevos + actualizados > 0) {
          notify(
            `📦 Catálogo ${nodo.nombre}: ${nuevos} nuevos, ${actualizados} actualizados (${sinCambiosOmitidos} sin cambios omitidos por Delta Hash)`,
            'success'
          );
        } else {
          notify(
            `✓ Catálogo ${nodo.nombre} al día (${totalLeidos} SKUs revisados, 0 cambios detectados por Delta Hash)`,
            'info'
          );
        }
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al ingestar catálogo Ailoo', 'error');
    } finally {
      setSincronizandoCatalogoNodo(null);
    }
  };

  const handleSincronizarTodosCatalogosAiloo = async () => {
    try {
      setSincronizandoTodosCatalogos(true);
      const res = await woocommerceService.syncAilooTodos({ forzar: false });
      if (res.success && res.data?.ingesta) {
        const { totalNuevos, totalActualizados, totalSinCambiosOmitidos, totalLeidos } =
          res.data.ingesta;
        if (totalNuevos + totalActualizados > 0) {
          notify(
            `📦 Multi-Ailoo → Firebase: ${totalNuevos} nuevos, ${totalActualizados} actualizados (${totalSinCambiosOmitidos} sin cambios)`,
            'success'
          );
        } else {
          notify(
            `✓ Catálogos Soluparts + Global sin cambios (${totalLeidos} SKUs con Delta Hash idéntico)`,
            'info'
          );
        }
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al sincronizar catálogos Ailoo', 'error');
    } finally {
      setSincronizandoTodosCatalogos(false);
    }
  };

  const handleSincronizarDeltaWoo = async () => {
    try {
      setSincronizandoWooDelta(true);
      const res = await woocommerceService.sync({ soloDelta: true });
      if (res.success && res.data) {
        const { creados, actualizados, omitidosSinCambio } = res.data;
        notify(
          `🛒 Sync Incremental WooCommerce: ${creados} creados, ${actualizados} actualizados (${omitidosSinCambio ?? 0} omitidos sin cambio)`,
          'success'
        );
        await cargarTodo();
      }
    } catch (err) {
      notify((err as Error).message || 'Error al sincronizar cola Delta con WooCommerce', 'error');
    } finally {
      setSincronizandoWooDelta(false);
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
        imagenUrl: nuevoEsc.imagenUrl,
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
            {esProveedor
              ? 'MOSTRADOR IA · CONSULTAS TÉCNICAS Y COMPATIBILIDAD'
              : 'CENTRO DE ESCALAMIENTO FEDERADO Y CONOCIMIENTO IA'}
          </h1>
          <p className={styles.subtitle}>
            {esProveedor
              ? 'Responde dudas técnicas de compatibilidad de tus repuestos. Cada respuesta le llega al cliente por WhatsApp, enseña al Agente IA y actualiza tus fichas.'
              : 'Conecta el Agente de FácilRepuestos con soluparts_ailoo.escalamientos, global_ailoo.escalamientos y el Portal de Proveedores Locales.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={cargarTodo}
            disabled={loading}
          >
            ↻ Actualizar bandeja
          </button>
          {!esProveedor && (
            <button
              className="btn btn-primary"
              onClick={() => setMostrarNuevoModal((v) => !v)}
            >
              {mostrarNuevoModal ? '✕ Cerrar Simulador' : '+ Derivar / Simular Escalamiento IA'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        <div
          className={`${styles.kpiCard} ${filtroEstado === 'pendiente' ? styles.kpiCardSelected : ''}`}
          onClick={() => {
            setTabActiva('escalamientos');
            setFiltroEstado('pendiente');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className={styles.kpiTopRow}>
            <span className={styles.kpiLabel}>Consultas Pendientes (SLA)</span>
            <span className={`${styles.kpiIconBadge} ${styles.kpiIconOrange}`}>⏳</span>
          </div>
          <div className={styles.kpiValue} style={{ color: totalPendientes > 0 ? '#ea580c' : '#10b981' }}>
            {totalPendientes}
          </div>
          <div className={styles.kpiSub}>
            {esProveedor
              ? 'Esperando validación de tu mostrador'
              : 'En cola entre Nodos Ailoo y Proveedores Locales'}
          </div>
        </div>

        <div
          className={`${styles.kpiCard} ${filtroEstado === 'respondido' ? styles.kpiCardSelected : ''}`}
          onClick={() => {
            setTabActiva('escalamientos');
            setFiltroEstado('respondido');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className={styles.kpiTopRow}>
            <span className={styles.kpiLabel}>Consultas Resueltas</span>
            <span className={`${styles.kpiIconBadge} ${styles.kpiIconGreen}`}>✓</span>
          </div>
          <div className={styles.kpiValue} style={{ color: '#059669' }}>
            {totalRespondidos}
          </div>
          <div className={styles.kpiSub}>Validadas y enviadas automáticamente al cliente</div>
        </div>

        <div
          className={`${styles.kpiCard} ${tabActiva === 'conocimiento' ? styles.kpiCardSelected : ''}`}
          onClick={() => setTabActiva('conocimiento')}
          style={{ cursor: 'pointer' }}
        >
          <div className={styles.kpiTopRow}>
            <span className={styles.kpiLabel}>Base Conocimiento IA</span>
            <span className={`${styles.kpiIconBadge} ${styles.kpiIconBlue}`}>🧠</span>
          </div>
          <div className={styles.kpiValue} style={{ color: '#2563eb' }}>
            {conocimiento.length}
          </div>
          <div className={styles.kpiSub}>Reglas técnicas aprendidas que la IA ya responde sola</div>
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

                  {nodo.ultimoResumenCatalogo && (
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: '#334155',
                        background: '#f1f5f9',
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <span>
                        📊 Catálogo ({nodo.tablaCatalogo || 'v_agente_catalogo'}):{' '}
                        <strong>{nodo.ultimoResumenCatalogo.totalLeidos} SKUs</strong>
                      </span>
                      <span>·</span>
                      <span style={{ color: '#059669', fontWeight: 700 }}>
                        +{nodo.ultimoResumenCatalogo.nuevos} nuevos
                      </span>
                      <span>·</span>
                      <span style={{ color: '#0284c7', fontWeight: 700 }}>
                        ↻ {nodo.ultimoResumenCatalogo.actualizados} mod.
                      </span>
                      <span>·</span>
                      <span style={{ color: '#64748b' }}>
                        ✓ {nodo.ultimoResumenCatalogo.sinCambiosOmitidos} sin cambio (Delta Hash)
                      </span>
                    </div>
                  )}

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

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{
                          borderColor: '#0284c7',
                          color: '#0369a1',
                          background: '#f0f9ff',
                          fontWeight: 700,
                        }}
                        disabled={sincronizandoCatalogoNodo === nodo.id}
                        onClick={() => handleSincronizarCatalogoNodoAiloo(nodo)}
                      >
                        {sincronizandoCatalogoNodo === nodo.id
                          ? 'Ingestando...'
                          : '📦 Ingestar Catálogo (Delta)'}
                      </button>

                      <button
                        className="btn btn-sm btn-primary"
                        disabled={sincronizandoNodo === nodo.id}
                        onClick={() => handleSincronizarNodoAiloo(nodo)}
                      >
                        {sincronizandoNodo === nodo.id
                          ? 'Sincronizando...'
                          : `🔄 Sync Escalamientos`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Panel Etapa 2: Conector Catálogo Multi-Ailoo → Firebase → Sync Incremental WooCommerce */}
          {estadoWoo && (
            <div
              style={{
                marginTop: 14,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                  🛒 Pipeline Multi-Ailoo → Firebase (`inventario`) → WooCommerce (Sync Incremental por Delta Hash)
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: '#475569',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <span>
                    Total en Firebase: <strong>{estadoWoo.totalInventario} SKUs</strong>
                  </span>
                  <span>·</span>
                  <span>
                    🔵 Soluparts: <strong>{estadoWoo.desglosePorOrigen.soluparts.total}</strong> (
                    {estadoWoo.desglosePorOrigen.soluparts.pendientes} pend.)
                  </span>
                  <span>·</span>
                  <span>
                    🟣 Global: <strong>{estadoWoo.desglosePorOrigen.global.total}</strong> (
                    {estadoWoo.desglosePorOrigen.global.pendientes} pend.)
                  </span>
                  <span>·</span>
                  <span>
                    🟢 Locales/Bodega: <strong>{estadoWoo.desglosePorOrigen.locales.total}</strong> (
                    {estadoWoo.desglosePorOrigen.locales.pendientes} pend.)
                  </span>
                  <span>·</span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: estadoWoo.pendientesSync > 0 ? '#d97706' : '#059669',
                    }}
                  >
                    Cola Delta WooCommerce: {estadoWoo.pendientesSync} pendiente(s)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={sincronizandoTodosCatalogos}
                  onClick={handleSincronizarTodosCatalogosAiloo}
                >
                  {sincronizandoTodosCatalogos
                    ? 'Ingestando Nodos...'
                    : '⚡ Ingestar Todos los Nodos Ailoo'}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  style={{ background: '#059669', borderColor: '#059669' }}
                  disabled={sincronizandoWooDelta}
                  onClick={handleSincronizarDeltaWoo}
                >
                  {sincronizandoWooDelta
                    ? 'Sincronizando Delta...'
                    : `🛒 Sincronizar Delta a WooCommerce (${estadoWoo.pendientesSync})`}
                </button>
              </div>
            </div>
          )}
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
              <label className={styles.fieldLabel}>
                Consulta Técnica a Escalar (🛡️ Sin Nombre ni Teléfono del Cliente — Solicitante: FácilRepuestos)
              </label>
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

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                📷 URL de Foto del Cliente (Opcional — si se incluye, se muestra como tarjeta con foto)
              </label>
              <input
                className={styles.input}
                placeholder="https://... (dejar vacío para escalamiento sin foto)"
                value={nuevoEsc.imagenUrl}
                onChange={(e) =>
                  setNuevoEsc((prev) => ({ ...prev, imagenUrl: e.target.value }))
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

      {/* CONTENIDO PESTAÑA 1: BANDEJA DE ESCALAMIENTOS (ESTILO PORTAL ESCALAMIENTO CON FOTO Y SIN FOTO) */}
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
              const fotoUrl = (esc.imagenUrl || esc.fotoMuestraUrl || '').trim();
              const tieneFoto = Boolean(fotoUrl);
              const refNeutral = String(esc.ticketRef || esc.id).replace(/^FRP-/i, '');
              const skuLimpio = String(esc.candidatoCodigo || refNeutral)
                .replace(/^FRP-(?:SOL|GLB|LOC|WSP|EXP)-/i, '')
                .trim();

              // Calcular tiempo relativo ("hace X min" / "hace X h")
              const tiempoRelativo = (() => {
                const diffMs = Math.max(0, Date.now() - new Date(esc.creadoEn).getTime());
                const mins = Math.floor(diffMs / 60000);
                if (mins < 2) return 'hace instantes';
                if (mins < 60) return `hace ${mins} min`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `hace ${hrs} h`;
                const dias = Math.floor(hrs / 24);
                return `hace ${dias} d`;
              })();

              const vehiculoPartes = [
                esc.marcaVehiculo && esc.marcaVehiculo !== 'POR CONFIRMAR' ? esc.marcaVehiculo : '',
                esc.modeloVehiculo || '',
                esc.anioVehiculo ? String(esc.anioVehiculo) : '',
                esc.motorVehiculo || '',
                esc.patente ? `(Patente ${esc.patente})` : '',
              ].filter(Boolean);

              const descripcionProducto = [
                esc.candidatoNombre || 'REPUESTO EN CONSULTA DE COMPATIBILIDAD',
                vehiculoPartes.length > 0 ? `para ${vehiculoPartes.join(' ')}` : '',
              ]
                .filter(Boolean)
                .join(' ');

              const conversacionTurnos =
                Array.isArray(esc.historialConversacion) && esc.historialConversacion.length > 0
                  ? esc.historialConversacion
                  : [
                      {
                        hora: new Date(esc.creadoEn).toLocaleTimeString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                        rol: 'cliente' as const,
                        autor: 'Cliente',
                        texto: esc.mensajeCliente,
                        envioFoto: tieneFoto,
                      },
                    ];

              const valorRespuestaInline =
                respuestasInline[esc.id] ??
                (abierto ? formRespuesta.respuestaMostrador : '');

              const setValorRespuestaCard = (nuevoTexto: string) => {
                setRespuestasInline((prev) => ({ ...prev, [esc.id]: nuevoTexto }));
                if (abierto) {
                  setFormRespuesta((prev) => ({ ...prev, respuestaMostrador: nuevoTexto }));
                }
              };

              return (
                <div key={esc.id} className={styles.soluDarkCard}>
                  {tieneFoto ? (
                    /* ─── VISTA 1: ESCALAMIENTO CON FOTO DEL CLIENTE (IDÉNTICO A PORTAL SOLUPARTS SIN TELÉFONO) ─── */
                    <div className={styles.soluPhotoGrid}>
                      <div className={styles.soluPhotoBox}>
                        <a
                          href={fotoUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir foto en tamaño completo"
                          style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                        >
                          <img
                            src={fotoUrl}
                            alt="Muestra enviada por el cliente"
                            className={styles.soluPhotoImg}
                          />
                        </a>
                      </div>

                      <div className={styles.soluRightCol}>
                        <div className={styles.soluMetaTop}>
                          <div className={styles.soluMetaLeft}>
                            <span className={styles.soluBadgeTeal}>Foto del cliente</span>
                            <span className={styles.soluTimeText}>{tiempoRelativo}</span>
                            {/* NUNCA se muestra el teléfono del cliente */}
                            <span className={styles.soluRefBadge}>Consulta #{refNeutral}</span>
                            {vehiculoPartes.length > 0 && (
                              <span className={styles.soluRefBadge}>
                                🚗 {vehiculoPartes.join(' ')}
                              </span>
                            )}
                          </div>
                          {esc.estado === 'respondido' ? (
                            <span className={styles.estadoBadgeRespondido}>✅ Respondido</span>
                          ) : (
                            <span className={styles.soluBadgeTeal}>1 cliente esperando</span>
                          )}
                        </div>

                        <div className={styles.soluProductDesc}>
                          {esc.mensajeCliente
                            ? esc.mensajeCliente
                            : 'El cliente adjuntó una fotografía de muestra para validar compatibilidad.'}
                        </div>

                        {(esc.pistaGemini || esc.motivoEscalamiento) && (
                          <div className={styles.soluGeminiHint}>
                            Pista de Gemini (el cliente no la ve): repuesto:{' '}
                            {esc.pistaGemini || esc.motivoEscalamiento}
                          </div>
                        )}

                        <div className={styles.soluChatBox}>
                          <div className={styles.soluChatHeader}>CONVERSACIÓN ANTES DE LA FOTO</div>
                          {conversacionTurnos.map((msg, idx) => (
                            <div key={idx} className={styles.soluChatLine}>
                              {msg.hora && <span className={styles.soluChatHour}>{msg.hora}</span>}
                              <span
                                className={
                                  msg.rol === 'cliente'
                                    ? styles.soluChatAuthorCliente
                                    : styles.soluChatAuthorAgente
                                }
                              >
                                {msg.rol === 'cliente' ? 'Cliente' : 'Asistente'}
                              </span>
                              <span>{msg.texto}</span>
                              {msg.envioFoto && (
                                <div style={{ marginTop: 6 }}>
                                  <span className={styles.soluBadgeTeal}>📷 Aquí envió la foto</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {esc.estado === 'respondido' ? (
                          <div className={styles.respuestaBox} style={{ color: '#0f172a' }}>
                            <div style={{ fontSize: '0.88rem', color: '#065f46' }}>
                              <strong>✓ Respuesta de Mostrador ({esc.respondidoPor}):</strong>{' '}
                              {esc.respuestaMostrador}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 6,
                              }}
                            >
                              <span className={styles.soluReplyLabel}>Respuesta para el cliente</span>
                              <button
                                type="button"
                                className={styles.soluAdvToggle}
                                onClick={() => abrirPanelRespuesta(esc)}
                              >
                                {abierto
                                  ? 'Ocultar vinculación de inventario'
                                  : '⚙️ Vincular SKU / precio de mi inventario'}
                              </button>
                            </div>
                            <textarea
                              className={styles.soluDarkTextarea}
                              placeholder="Ejemplo: Es la pastilla delantera del Tiggo 2. La tenemos a $15.990, código PAS-DEL-1156K."
                              value={valorRespuestaInline}
                              onChange={(e) => setValorRespuestaCard(e.target.value)}
                            />
                            <div className={styles.soluFooterRow}>
                              <span className={styles.soluTimeText}>
                                Le llega de inmediato por WhatsApp.
                              </span>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {!esProveedor && (
                                  <button
                                    type="button"
                                    className={styles.soluQuickPillBtn}
                                    onClick={() =>
                                      navigate('/mesa-wsp', {
                                        state: {
                                          desdeEscalamiento: true,
                                          escalamientoId: esc.id,
                                          patente: esc.patente || '',
                                          marcaVehiculo: esc.marcaVehiculo || '',
                                          modeloVehiculo: esc.modeloVehiculo || '',
                                          anioVehiculo: esc.anioVehiculo || '',
                                          motorVehiculo: esc.motorVehiculo || '',
                                          repuestoBuscado: esc.candidatoNombre || esc.mensajeCliente,
                                          codigoReferencia: esc.candidatoCodigo || '',
                                          motivoEscalamiento: esc.motivoEscalamiento || '',
                                        },
                                      })
                                    }
                                  >
                                    📲 Derivar a Mesa WSP
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={styles.soluSendBtn}
                                  disabled={enviandoInlineId === esc.id}
                                  onClick={() => handleEnviarRespuesta(esc)}
                                >
                                  {enviandoInlineId === esc.id
                                    ? 'Enviando...'
                                    : 'Responder al cliente'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* ─── VISTA 2: ESCALAMIENTO SIN FOTO (REFERENCIA DE PRODUCTO + DUDA ENTRE COMILLAS + BOTONES RÁPIDOS) ─── */
                    <div className={styles.soluRightCol}>
                      <div className={styles.soluMetaTop}>
                        <div className={styles.soluMetaLeft}>
                          <span className={styles.soluBadgeSku}>{skuLimpio}</span>
                          {esc.patente && (
                            <span className={styles.soluRefBadge}>Patente: {esc.patente}</span>
                          )}
                          <span className={styles.soluRefBadge}>Ref #{refNeutral}</span>
                        </div>
                        {esc.estado === 'respondido' ? (
                          <span className={styles.estadoBadgeRespondido}>✅ Respondido</span>
                        ) : (
                          <span className={styles.soluBadgeTeal}>1 cliente esperando</span>
                        )}
                      </div>

                      <p className={styles.soluProductDesc}>{descripcionProducto}</p>

                      <div className={styles.soluQuotedQuestion}>
                        «{esc.motivoEscalamiento || esc.mensajeCliente}»
                      </div>

                      {/* Contexto de la conversación de escalamiento sin número telefónico */}
                      <div className={styles.soluChatBox}>
                        <div className={styles.soluChatHeader}>
                          CONTEXTO DE LA CONSULTA · Primera consulta {tiempoRelativo}
                        </div>
                        {conversacionTurnos.map((msg, idx) => (
                          <div key={idx} className={styles.soluChatLine}>
                            {msg.hora && <span className={styles.soluChatHour}>{msg.hora}</span>}
                            <span
                              className={
                                msg.rol === 'cliente'
                                  ? styles.soluChatAuthorCliente
                                  : styles.soluChatAuthorAgente
                              }
                            >
                              {msg.rol === 'cliente' ? 'Cliente' : 'Asistente'}
                            </span>
                            <span>{msg.texto}</span>
                          </div>
                        ))}
                        {esc.transcripcionAudio && (
                          <div className={styles.soluChatLine} style={{ color: '#b45309', fontWeight: 700 }}>
                            🎙️ Audio del cliente: "{esc.transcripcionAudio}"
                          </div>
                        )}
                      </div>

                      {esc.estado === 'respondido' ? (
                        <div className={styles.respuestaBox} style={{ color: '#0f172a' }}>
                          <div style={{ fontSize: '0.88rem', color: '#065f46' }}>
                            <strong>✓ Respuesta de Mostrador ({esc.respondidoPor}):</strong>{' '}
                            {esc.respuestaMostrador}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.soluQuickPills}>
                            {[
                              'Sí, es compatible con ese vehículo',
                              'No es compatible con ese vehículo',
                              'Para confirmarlo necesito la patente del vehículo',
                              'Sí, tenemos stock disponible para entrega inmediata',
                            ].map((sugerencia) => (
                              <button
                                key={sugerencia}
                                type="button"
                                className={styles.soluQuickPillBtn}
                                onClick={() => setValorRespuestaCard(sugerencia)}
                              >
                                {sugerencia}
                              </button>
                            ))}
                          </div>

                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 6,
                              }}
                            >
                              <span className={styles.soluReplyLabel}>
                                Respuesta (le llega a cada cliente por el chat)
                              </span>
                              <button
                                type="button"
                                className={styles.soluAdvToggle}
                                onClick={() => abrirPanelRespuesta(esc)}
                              >
                                {abierto
                                  ? 'Ocultar vinculación de inventario'
                                  : '⚙️ Vincular SKU / precio de mi inventario'}
                              </button>
                            </div>
                            <textarea
                              className={styles.soluDarkTextarea}
                              placeholder="Escribe la confirmación técnica de compatibilidad o marca/medida del repuesto..."
                              value={valorRespuestaInline}
                              onChange={(e) => setValorRespuestaCard(e.target.value)}
                            />
                            <div
                              className={styles.soluFooterRow}
                              style={{ justifyContent: 'flex-end' }}
                            >
                              {!esProveedor && (
                                <button
                                  type="button"
                                  className={styles.soluQuickPillBtn}
                                  onClick={() =>
                                    navigate('/mesa-wsp', {
                                      state: {
                                        desdeEscalamiento: true,
                                        escalamientoId: esc.id,
                                        patente: esc.patente || '',
                                        marcaVehiculo: esc.marcaVehiculo || '',
                                        modeloVehiculo: esc.modeloVehiculo || '',
                                        anioVehiculo: esc.anioVehiculo || '',
                                        motorVehiculo: esc.motorVehiculo || '',
                                        repuestoBuscado: esc.candidatoNombre || esc.mensajeCliente,
                                        codigoReferencia: esc.candidatoCodigo || '',
                                        motivoEscalamiento: esc.motivoEscalamiento || '',
                                      },
                                    })
                                  }
                                >
                                  📲 Derivar a Mesa WSP
                                </button>
                              )}
                              <button
                                type="button"
                                className={styles.soluSendBtn}
                                disabled={enviandoInlineId === esc.id}
                                onClick={() => handleEnviarRespuesta(esc)}
                              >
                                {enviandoInlineId === esc.id ? 'Enviando...' : 'Responder'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Panel opcional desplegable para vincular repuesto del inventario y enriquecer ficha */}
                  {abierto && (
                    <div className={styles.replyPanel} style={{ color: '#0f172a' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>
                        ⚙️ Vincular Repuesto de Inventario y Regla de Compatibilidad (Opcional)
                      </div>

                      <div className={styles.formGrid}>
                        <div className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
                          <label className={styles.fieldLabel}>
                            Vincular Repuesto de mi Inventario
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

                      <div className={styles.formGrid}>
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
                      </div>

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
