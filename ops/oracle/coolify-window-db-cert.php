<?php
// Persists the Cloudflare Origin CA certificate in Coolify's own records for the
// Window database, so routine Coolify starts/redeploys keep serving it.
//
// Coolify keeps (1) an SslCertificate row (encrypted certificate + key) and
// (2) LocalFileVolume rows for the bind-mounted server.crt / server.key / server.pem.
// StartPostgresql reuses the first SslCertificate of the database and writes the
// file volumes from their stored content, so updating both through the models is
// what makes the change survive. Only this database's rows are touched; the server
// CA and every other resource are left alone.
//
// Usage (reads {"crt": "...", "key": "..."} from stdin; nothing secret is printed):
//   php artisan tinker --execute="require '/path/to/this/file.php';"   (with MODE=inspect|apply)
//
// Run through ops/oracle/window-db-coolify-cert.sh, which supplies stdin and MODE.

use App\Models\StandalonePostgresql;

$uuid = getenv('WINDOW_DB_UUID') ?: 'w2c1as5kuqogvg0mb4jilfvy';
$mode = getenv('MODE') ?: 'inspect';

$db = StandalonePostgresql::where('uuid', $uuid)->firstOrFail();
$sslCertificate = $db->sslCertificates()->first();
$volumes = $db->fileStorages()->get();

if ($mode === 'inspect') {
    echo "database: {$db->name} ({$db->uuid}) ssl_mode={$db->ssl_mode} enable_ssl=".json_encode($db->enable_ssl)."\n";
    echo $sslCertificate
        ? "ssl certificate: id={$sslCertificate->id} cn={$sslCertificate->common_name} sans=".json_encode($sslCertificate->subject_alternative_names)." valid_until={$sslCertificate->valid_until}\n"
        : "ssl certificate: none\n";
    foreach ($volumes as $volume) {
        $isSslFile = in_array(basename($volume->mount_path), ['server.crt', 'server.key', 'server.pem'], true);
        echo "file volume: id={$volume->id} fs_path={$volume->fs_path} mount_path={$volume->mount_path}".($isSslFile ? ' [ssl]' : '')."\n";
    }
    return;
}

$input = json_decode(stream_get_contents(fopen('php://stdin', 'r')), true);
$crt = trim($input['crt'] ?? '');
$key = trim($input['key'] ?? '');
if ($crt === '' || $key === '') {
    throw new RuntimeException('certificate and key are required on stdin');
}
if (! $sslCertificate) {
    throw new RuntimeException('database has no SslCertificate row; start it once from Coolify first');
}

$parsed = openssl_x509_parse($crt);
if (! $parsed || ! openssl_x509_check_private_key($crt, $key)) {
    throw new RuntimeException('certificate is unreadable or does not match the private key');
}
$sans = collect(explode(',', $parsed['extensions']['subjectAltName'] ?? ''))
    ->map(fn ($san) => trim(str_replace('DNS:', '', $san)))
    ->filter()
    ->values()
    ->all();

$sslCertificate->update([
    'ssl_certificate' => $crt,
    'ssl_private_key' => $key,
    'common_name' => $sans[0] ?? $sslCertificate->common_name,
    'subject_alternative_names' => $sans,
    'valid_until' => \Carbon\Carbon::createFromTimestampUTC($parsed['validTo_time_t']),
]);

foreach ($volumes as $volume) {
    $content = match (basename($volume->mount_path)) {
        'server.crt' => $crt,
        'server.key' => $key,
        'server.pem' => $crt."\n".$key,
        default => null,
    };
    if ($content === null) {
        continue;
    }
    $volume->content = $content;
    $volume->save();
    $volume->saveStorageOnServer();
    echo "updated {$volume->mount_path}\n";
}

echo "updated SslCertificate id={$sslCertificate->id} cn={$sslCertificate->common_name} sans=".json_encode($sans)." valid_until={$sslCertificate->valid_until}\n";
