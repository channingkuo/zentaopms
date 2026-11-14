#!/usr/bin/env php
<?php
/** Test the actual upload/install extractor, compatibility check and payload copy. */
require dirname(__DIR__, 2) . '/test/lib/init.php';
$code = 'xmwprogramgantt';
$expectedVersion = $argv[2] ?? trim(file_get_contents(dirname(__DIR__, 2) . '/scripts/program-gantt/VERSION'));
$zipPath = $argv[1] ?? dirname(__DIR__, 2) . '/dist/' . $code . '-' . $expectedVersion . '.zip';
$tester->loadModel('extension');
if(!class_exists('extension', false)) require dirname(__DIR__, 2) . '/module/extension/control.php';
require_once dirname(__DIR__, 2) . '/module/extension/zen.php';

/* Redirect only the archive and extraction paths; use the real extension methods. */
class ganttPackageExtension extends extensionModel
{
    public string $archive;
    public function getPackageFile(string $extension): string { return $this->archive; }
}
$extension = new ganttPackageExtension();
$extension->archive = $zipPath;
$target = sys_get_temp_dir() . '/gantt-package-' . bin2hex(random_bytes(6)) . '/';
mkdir($target . 'pkg',0700,true);
mkdir($target . 'installed',0700,true);
$extension->pkgRoot = $target . 'pkg/';
$zen = (new ReflectionClass('extensionZen'))->newInstanceWithoutConstructor();
$zen->app = new class($app, $target . 'installed/')
{
    public function __construct(private object $realApp, private string $root) {}
    public function getAppRoot(): string { return $this->root; }
    public function __call(string $method, array $args): mixed { return $this->realApp->$method(...$args); }
};
$zen->extension = $extension;
$zen->lang = $lang;
$zen->view = new stdclass();
$extract = new ReflectionMethod('extensionZen', 'extractPackage');
$compatible = new ReflectionMethod('extensionZen', 'checkCompatible');
$copy = new ReflectionMethod('extensionZen', 'copyPackageFiles');

try
{
    /* Upload first extracts using the ZIP filename, then discovers its canonical code. */
    $uploadCode = basename($zipPath, '.zip');
    $result = $extract->invoke($zen, $uploadCode);
    if($result->result !== 'ok') throw new RuntimeException('Upload extraction failed: ' . $result->error);
    $uploaded = $extension->parseExtensionCFG($uploadCode);
    if(($uploaded->code ?? '') !== $code || ($uploaded->version ?? '') !== $expectedVersion)
        throw new RuntimeException('Upload extractor lost plugin metadata. Check the first ZIP directory entry.');

    /* Installation re-extracts to the canonical plugin-code directory. */
    $result = $extract->invoke($zen, $code);
    if($result->result !== 'ok') throw new RuntimeException('Install extraction failed: ' . $result->error);
    $info = $extension->getInfoFromPackage($code);
    $condition = $extension->getCondition($code);
    if($info->code !== $code || $info->version !== $expectedVersion || $condition->zentao['compatible'] !== '22.7')
        throw new RuntimeException('Installer metadata does not match.');
    if(!$compatible->invoke($zen, $code, $condition, 'no', '', 'install'))
        throw new RuntimeException('Normal installation failed compatibility checks.');
    if($extension->checkVersion('22.6')) throw new RuntimeException('Unrelated version accepted.');
    if(count($extension->getFilesFromPackage($code)) !== 23) throw new RuntimeException('Unexpected installer payload.');

    $files = $copy->invoke($zen, $code);
    if(count($files) !== 23) throw new RuntimeException('Installer did not copy all plugin files.');
    foreach($files as $file => $hash)
    {
        if(!str_starts_with($file, $target . 'installed/extension/custom/') || !is_file($file) || md5_file($file) !== $hash)
            throw new RuntimeException('Installed payload path or content is incorrect.');
    }
    if(!is_file($target . 'installed/extension/custom/program/ext/control/gantt.php'))
        throw new RuntimeException('Gantt controller was not installed in the application tree.');
    echo "ZenTao upload extraction, normal compatibility check and all 23 installed files passed.\n";
}
finally
{
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($target,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($iterator as $file) $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    rmdir($target);
}
