#!/usr/bin/env php
<?php
/** Validate the ZIP using ZenTao's actual metadata parser, without installing files. */
require dirname(__DIR__, 2) . '/test/lib/init.php';
$code = 'xmwprogramgantt';
$zipPath = dirname(__DIR__, 2) . '/dist/' . $code . '-1.0.0.zip';
$extension = $tester->loadModel('extension');
$target = sys_get_temp_dir() . '/gantt-package-' . bin2hex(random_bytes(6)) . '/';
mkdir($target,0700,true);
$original = $extension->pkgRoot;
try
{
    $zip = new ZipArchive();
    if($zip->open($zipPath) !== true) throw new RuntimeException('Build the plugin ZIP first.');
    $zip->extractTo($target);$zip->close();
    $extension->pkgRoot=$target;
    $info=$extension->getInfoFromPackage($code);
    $condition=$extension->getCondition($code);
    if($info->code!==$code || $info->version!=='1.0.0' || $condition->zentao['compatible']!=='22.7')
        throw new RuntimeException('Installer metadata does not match.');
    if(count($extension->getFilesFromPackage($code))!==23) throw new RuntimeException('Unexpected installer payload.');
    echo "ZenTao extension metadata and payload validation passed.\n";
}
finally
{
    $extension->pkgRoot=$original;
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($target,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($iterator as $file) $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    rmdir($target);
}
