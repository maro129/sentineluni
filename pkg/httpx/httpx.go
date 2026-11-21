// Package httpx tiene utilidades HTTP comunes: JSON, errores e identidad del usuario.
package httpx

import (
	"encoding/json"
	"net/http"
	"slices"
)

// JSON responde con el código y el cuerpo serializado.
func JSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// Error responde {"error": msg}.
func Error(w http.ResponseWriter, code int, msg string) {
	JSON(w, code, map[string]string{"error": msg})
}

// Identity es el usuario autenticado. El API Gateway (Traefik forwardAuth) valida el JWT
// en User Service y reemplaza estas cabeceras; los servicios no están expuestos fuera de la red interna.
type Identity struct {
	User string
	Role string
}

// IdentityFrom lee X-User y X-Role puestas por el API Gateway.
func IdentityFrom(r *http.Request) Identity {
	return Identity{User: r.Header.Get("X-User"), Role: r.Header.Get("X-Role")}
}

// HasRole indica si la identidad tiene alguno de los roles dados.
func (i Identity) HasRole(roles ...string) bool { return slices.Contains(roles, i.Role) }

// Health es el handler /health común.
func Health(w http.ResponseWriter, _ *http.Request) {
	JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RequireRole deja pasar solo a las identidades con alguno de los roles dados (403 si no).
func RequireRole(h http.HandlerFunc, roles ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !IdentityFrom(r).HasRole(roles...) {
			Error(w, http.StatusForbidden, "No tienes permiso para esta sección")
			return
		}
		h(w, r)
	}
}
