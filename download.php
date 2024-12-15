<?php
$file = $_GET['file'];
$allowedFiles = ['file1.exe', 'file2.dmg']; // Liste erlaubter Dateien
$filePath = "downloads/$file";

if (!in_array($file, $allowedFiles) || !file_exists($filePath)) {
    die('Datei nicht gefunden oder nicht erlaubt!');
}

header('Content-Description: File Transfer');
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename=' . basename($filePath));
readfile($filePath);
exit;
?>
