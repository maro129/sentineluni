package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"sentineluni/pkg/bus"
	"sentineluni/pkg/httpx"
)

var (
	incidentTypes = []string{"phishing", "malware", "ransomware", "acceso_no_autorizado", "ddos", "fuga_de_datos", "otro"}
	statuses      = []string{"Nuevo", "Clasificado", "En análisis", "Resuelto"}
	// Tipos de archivo aceptados como evidencia (se detectan por contenido, no por extensión).
	evidenceTypes = []string{"image/png", "image/jpeg", "application/pdf", "text/plain"}
)

const maxEvidence = 5 << 20 // 5 MB

// API agrupa los handlers HTTP.
type API struct {
	store    *Store
	evidence *EvidenceStore
	bus      *bus.Bus
}

type createReq struct {
	Title       string `json:"title"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Asset       string `json:"asset"`
}

func (a *API) list(w http.ResponseWriter, r *http.Request) {
	id := httpx.IdentityFrom(r)
	reporter := ""
	if id.Role == "reporter" { // un usuario reportante solo ve sus propios incidentes
		reporter = id.User
	}
	items, err := a.store.List(r.Context(), reporter)
	if err != nil {
		slog.Error("listar incidentes", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "Error al listar incidentes")
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	inc, ok := a.load(w, r)
	if ok {
		httpx.JSON(w, http.StatusOK, inc)
	}
}

// load busca el incidente y aplica la regla de visibilidad por rol.
func (a *API) load(w http.ResponseWriter, r *http.Request) (Incident, bool) {
	inc, err := a.store.Get(r.Context(), r.PathValue("id"))
	id := httpx.IdentityFrom(r)
	if errors.Is(err, ErrNotFound) || (err == nil && id.Role == "reporter" && inc.ReportedBy != id.User) {
		httpx.Error(w, http.StatusNotFound, "Incidente no encontrado")
		return inc, false
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Error al leer el incidente")
		return inc, false
	}
	return inc, true
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxEvidence+1<<20)
	var req createReq
	var file multipart.File
	var header *multipart.FileHeader

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(maxEvidence); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Formulario inválido o archivo mayor a 5 MB")
			return
		}
		req = createReq{Title: r.FormValue("title"), Type: r.FormValue("type"), Description: r.FormValue("description"), Asset: r.FormValue("asset")}
		if f, h, err := r.FormFile("evidence"); err == nil {
			file, header = f, h
			defer f.Close()
		}
	} else if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "JSON inválido")
		return
	}

	req.Title, req.Description, req.Asset = strings.TrimSpace(req.Title), strings.TrimSpace(req.Description), strings.TrimSpace(req.Asset)
	if len([]rune(req.Title)) < 5 || len([]rune(req.Title)) > 120 {
		httpx.Error(w, http.StatusBadRequest, "El título debe tener entre 5 y 120 caracteres")
		return
	}
	if !slices.Contains(incidentTypes, req.Type) {
		httpx.Error(w, http.StatusBadRequest, "Tipo inválido. Usa: "+strings.Join(incidentTypes, ", "))
		return
	}
	if len(req.Description) > 2000 || len(req.Asset) > 120 {
		httpx.Error(w, http.StatusBadRequest, "Descripción o activo demasiado largos")
		return
	}

	now := time.Now().UTC()
	inc := Incident{
		ID: "INC-" + strings.ToUpper(bus.NewID(3)), Title: req.Title, Type: req.Type, Description: req.Description,
		Asset: req.Asset, Status: "Nuevo", Severity: "Pendiente", TriageReasons: []string{},
		ReportedBy: httpx.IdentityFrom(r).User, CreatedAt: now, UpdatedAt: now,
	}
	if inc.ReportedBy == "" {
		inc.ReportedBy = "desconocido"
	}

	if file != nil {
		if !a.evidence.Enabled() {
			httpx.Error(w, http.StatusServiceUnavailable, "Object Storage no disponible")
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, maxEvidence+1))
		if err != nil || len(data) > maxEvidence {
			httpx.Error(w, http.StatusBadRequest, "La evidencia debe pesar como máximo 5 MB")
			return
		}
		ctype := strings.Split(http.DetectContentType(data), ";")[0]
		if !slices.Contains(evidenceTypes, ctype) {
			httpx.Error(w, http.StatusBadRequest, "Evidencia no permitida: usa PNG, JPG, PDF o TXT")
			return
		}
		key, err := a.evidence.Put(r.Context(), inc.ID, header.Filename, ctype, bytes.NewReader(data), int64(len(data)))
		if err != nil {
			slog.Error("subir evidencia", "err", err)
			httpx.Error(w, http.StatusBadGateway, "No se pudo guardar la evidencia")
			return
		}
		name := header.Filename
		inc.EvidenceKey, inc.EvidenceName = &key, &name
	}

	ev, err := a.bus.NewEvent(bus.IncidentCreated, bus.IncidentCreatedData{
		IncidentID: inc.ID, Title: inc.Title, Type: inc.Type, Description: inc.Description,
		Asset: inc.Asset, ReportedBy: inc.ReportedBy, HasEvidence: inc.EvidenceKey != nil,
	})
	if err == nil {
		err = a.store.Create(r.Context(), inc, ev)
	}
	if err != nil {
		slog.Error("crear incidente", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "No se pudo registrar el incidente")
		return
	}
	// Responde de inmediato: el evento sale por el outbox y nadie espera a los consumidores.
	httpx.JSON(w, http.StatusCreated, inc)
}

func (a *API) changeStatus(w http.ResponseWriter, r *http.Request) {
	id := httpx.IdentityFrom(r)
	if !id.HasRole("analyst", "admin") {
		httpx.Error(w, http.StatusForbidden, "Solo un analista o administrador puede cambiar el estado")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&body); err != nil || !slices.Contains(statuses, body.Status) {
		httpx.Error(w, http.StatusBadRequest, "Estado inválido. Usa: "+strings.Join(statuses, ", "))
		return
	}
	inc, err := a.store.ChangeStatus(r.Context(), a.bus, r.PathValue("id"), body.Status, id.User)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Incidente no encontrado")
	case errors.Is(err, ErrTransition):
		httpx.Error(w, http.StatusConflict, err.Error())
	case err != nil:
		slog.Error("cambiar estado", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "No se pudo cambiar el estado")
	default:
		httpx.JSON(w, http.StatusOK, inc)
	}
}

func (a *API) downloadEvidence(w http.ResponseWriter, r *http.Request) {
	inc, ok := a.load(w, r)
	if !ok {
		return
	}
	if inc.EvidenceKey == nil || !a.evidence.Enabled() {
		httpx.Error(w, http.StatusNotFound, "El incidente no tiene evidencia")
		return
	}
	obj, info, err := a.evidence.Get(r.Context(), *inc.EvidenceKey)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "No se pudo leer la evidencia")
		return
	}
	defer obj.Close()
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeName(*inc.EvidenceName)+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, obj)
}
