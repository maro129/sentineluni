package main

import (
	"fmt"
	"strings"
)

// Levels son las severidades de menor a mayor.
var Levels = []string{"Baja", "Media", "Alta", "Crítica"}

// baseByType es la severidad base según el tipo de incidente.
var baseByType = map[string]string{
	"phishing":             "Media",
	"malware":              "Alta",
	"ransomware":           "Crítica",
	"acceso_no_autorizado": "Alta",
	"ddos":                 "Alta",
	"fuga_de_datos":        "Crítica",
	"otro":                 "Baja",
}

// escalate son palabras que indican mayor impacto: suben un nivel la severidad.
var escalate = []string{"servidor", "producción", "produccion", "credenciales", "contraseña", "admin",
	"base de datos", "masivo", "todos los usuarios", "cifrado"}

func indexOf(level string) int {
	for i, l := range Levels {
		if l == level {
			return i
		}
	}
	return 0
}

// Classify calcula la severidad y los motivos (reglas simples y explicables).
func Classify(typ, title, description, asset string) (string, []string) {
	base, ok := baseByType[typ]
	if !ok {
		base = "Baja"
	}
	level := indexOf(base)
	reasons := []string{fmt.Sprintf("Tipo %q → severidad base %s", typ, Levels[level])}
	text := strings.ToLower(title + " " + description + " " + asset)
	var hits []string
	for _, w := range escalate {
		if strings.Contains(text, w) {
			hits = append(hits, w)
		}
	}
	switch {
	case len(hits) > 0 && level < len(Levels)-1:
		level++
		reasons = append(reasons, fmt.Sprintf("Palabras de alto impacto (%s) → sube a %s", strings.Join(hits, ", "), Levels[level]))
	case len(hits) > 0:
		reasons = append(reasons, fmt.Sprintf("Palabras de alto impacto (%s); ya está en el nivel máximo", strings.Join(hits, ", ")))
	}
	return Levels[level], reasons
}
