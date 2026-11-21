package main

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		name, typ, title, desc, asset, want string
		reasons                             int
	}{
		{"phishing base", "phishing", "Correo sospechoso", "", "", "Media", 1},
		{"phishing con credenciales sube", "phishing", "Correo pide credenciales", "", "correo", "Alta", 2},
		{"ransomware ya es máximo", "ransomware", "Archivos cifrado en servidor", "", "", "Crítica", 2},
		{"tipo desconocido es Baja", "xyz", "Algo raro", "", "", "Baja", 1},
		{"otro + servidor", "otro", "Ruido", "en el servidor web", "", "Media", 2},
		{"mayúsculas", "malware", "Virus en SERVIDOR de PRODUCCIÓN", "", "", "Crítica", 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, reasons := Classify(c.typ, c.title, c.desc, c.asset)
			if got != c.want || len(reasons) != c.reasons {
				t.Fatalf("Classify() = %s %v, quiero %s con %d motivos", got, reasons, c.want, c.reasons)
			}
		})
	}
}
