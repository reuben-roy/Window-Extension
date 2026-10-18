<?php
// Restarts the Window database through Coolify's own RestartDatabase action
// (the same code path as the dashboard's Restart button: stop, remove container,
// regenerate files from Coolify's records, docker compose up). Touches only this
// database. Used to prove the Origin CA certificate survives a Coolify redeploy.
//
//   docker cp coolify-restart-window-db.php coolify:/tmp/
//   docker exec coolify php artisan tinker --execute="require '/tmp/coolify-restart-window-db.php';"

use App\Actions\Database\RestartDatabase;
use App\Models\StandalonePostgresql;

$db = StandalonePostgresql::where('uuid', getenv('WINDOW_DB_UUID') ?: 'w2c1as5kuqogvg0mb4jilfvy')->firstOrFail();
$result = RestartDatabase::run($db);
echo 'restart dispatched for '.$db->name.' ('.$db->uuid.'): '.(is_object($result) ? get_class($result) : (string) $result)."\n";
