#!/usr/bin/env php
<?php
/** Load the real router and core languages in a fresh process for every feature mode. */
$root = dirname(__DIR__, 2);
if(!isset($argv[1]))
{
    foreach(array('zh-cn','zh-tw','en','de','fr') as $locale)
    {
        foreach(array('enabled','light','disabled') as $mode)
        {
            $process = proc_open(array(PHP_BINARY, '-c', php_ini_loaded_file(), __FILE__, $mode, $locale), array(1=>array('pipe','w'),2=>array('pipe','w')), $pipes);
            $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);
            fclose($pipes[1]);fclose($pipes[2]);
            if(proc_close($process)!==0) { fwrite(STDERR,$out.$err); exit(1); }
            echo $out;
        }
    }
    exit;
}
$mode=$argv[1];$locale=$argv[2];
chdir($root . '/www');
require '../framework/router.class.php';
require '../framework/control.class.php';
require '../framework/model.class.php';
require '../framework/helper.class.php';
$app=router::createApp('pms',$root,'router');
$app->loadTarget('common');
/* Use complete core translations; exercise every plugin locale explicitly below. */
$app->clientLang=$locale==='zh-cn' ? 'zh-cn' : 'en';
$config->systemMode=$mode==='light' ? 'light' : 'ALM';
$config->disabledFeatures=$mode==='disabled' ? 'program' : '';

/* Exercise the same group-language load that project config triggers during login. */
$app->loadLang('group');
include $root . '/extension/custom/group/ext/lang/' . $locale . '/programgantt.php';
$app->loadModuleConfig('group');
$enabled=$mode==='enabled';
if(isset($lang->resource->program->gantt)!==$enabled) throw new RuntimeException('Wrong program privilege visibility.');
if(!$enabled && isset($lang->resource->program)) throw new RuntimeException('Plugin recreated a disabled core resource.');
if(isset($config->group->package->programGantt)!==$enabled) throw new RuntimeException('Wrong privilege package visibility.');

/* Reload the real common language to validate the navigation extension in this mode. */
router::$loadedLangs=array();
(new ReflectionMethod('baseRouter','loadLang'))->invoke($app,'common');
include $root . '/extension/custom/common/ext/lang/' . $locale . '/programgantt.php';
if(isset($lang->program->homeMenu->gantt)!==$enabled || isset($lang->program->menu->gantt)!==$enabled)
    throw new RuntimeException('Wrong Gantt navigation visibility.');

/* Also load the real project model/config, reproducing the reported login call path. */
$project=$app->loadTarget('project');
$app->user=(object)array('account'=>'gantt-mode-test','admin'=>true,'view'=>(object)array('programs'=>'','projects'=>'','sprints'=>''));
$program=$app->loadTarget('program');
$service=$program->loadExtension('programgantt');
if($enabled)
{
    $service->getData();
}
else
{
    foreach(array(fn()=>$service->getData(),fn()=>$service->saveDates('program',1,'2026-01-01','2026-01-02','','')) as $action)
    {
        try { $action(); throw new RuntimeException('Disabled feature was accessible.'); }
        catch(DomainException $error) { if($error->getMessage()!==$lang->program->ganttLang['featureDisabled']) throw $error; }
    }
}
/* A locale may omit the label container even with an enabled program resource. */
$originalLang=$lang;
$lang=(object)array('resource'=>(object)array('program'=>new stdclass()),'group'=>new stdclass());
include $root . '/extension/custom/group/ext/lang/' . $locale . '/programgantt.php';
if(!isset($lang->group->package->programGantt)) throw new RuntimeException('Missing optional label container was not initialized.');
$lang=$originalLang;
echo "PASS: $locale plugin / $mode: resource guard, labels, project startup, navigation and feature access\n";
