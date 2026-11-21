// Package config lee la configuración de cada servicio desde variables de entorno.
package config

import "os"

// Env devuelve la variable de entorno key o def si no está definida.
func Env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
