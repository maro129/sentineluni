#!/bin/sh
# Una base de datos y un usuario por microservicio: cada servicio es dueño de sus datos
# y no puede leer las tablas de los demás.
set -e
create() { # base usuario contraseña
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE USER $2 WITH PASSWORD '$3';
CREATE DATABASE $1 OWNER $2;
REVOKE ALL ON DATABASE $1 FROM PUBLIC;
SQL
}
create users_db users_svc "$USERS_DB_PASSWORD"
create incidents_db incidents_svc "$INCIDENTS_DB_PASSWORD"
create notifications_db notifications_svc "$NOTIFICATIONS_DB_PASSWORD"
