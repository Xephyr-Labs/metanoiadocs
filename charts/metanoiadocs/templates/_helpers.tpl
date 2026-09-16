{{/* The release's base name, truncated to what a Kubernetes name allows. */}}
{{- define "metanoiadocs.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "metanoiadocs.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "metanoiadocs.labels" -}}
app.kubernetes.io/name: {{ include "metanoiadocs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "metanoiadocs.selectorLabels" -}}
app.kubernetes.io/name: {{ include "metanoiadocs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
The Postgres password.

Generated once, on first install, and then read back out of the live Secret on
every upgrade. Regenerating it would leave the app holding a password its own
database no longer accepts — a broken release with no error message that names
the cause.
*/}}
{{- define "metanoiadocs.pgPassword" -}}
{{- if .Values.postgres.password -}}
{{- .Values.postgres.password -}}
{{- else -}}
{{- $secret := lookup "v1" "Secret" .Release.Namespace (printf "%s-db" (include "metanoiadocs.fullname" .)) -}}
{{- if $secret -}}
{{- index $secret.data "password" | b64dec -}}
{{- else -}}
{{- randAlphaNum 32 -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* The connection string the server gets, bundled Postgres or not. */}}
{{- define "metanoiadocs.databaseUrl" -}}
{{- if .Values.externalDatabase.url -}}
{{- .Values.externalDatabase.url -}}
{{- else -}}
{{- printf "postgresql://%s:%s@%s-db:5432/%s"
      .Values.postgres.user
      (include "metanoiadocs.pgPassword" .)
      (include "metanoiadocs.fullname" .)
      .Values.postgres.database -}}
{{- end -}}
{{- end -}}
