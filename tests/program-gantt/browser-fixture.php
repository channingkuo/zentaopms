#!/usr/bin/env php
<?php
/** Opt-in fixtures for a disposable LOCAL application database. */
if(getenv('GANTT_BROWSER_FIXTURE') !== '1') die("Set GANTT_BROWSER_FIXTURE=1 for a disposable local database.\n");
$root = dirname(__DIR__, 2);
chdir($root . '/www');
require '../framework/router.class.php';
require '../framework/control.class.php';
require '../framework/model.class.php';
require '../framework/helper.class.php';
$app = router::createApp('pms', $root, 'router');
$tester = $app->loadCommon();
$stateFile = $argv[2] ?? sys_get_temp_dir() . '/program-gantt-fixture.json';
$dao = $tester->dao;
if(($argv[1] ?? '') === 'cleanup')
{
    if(!is_file($stateFile)) exit;
    $state = json_decode(file_get_contents($stateFile), true);
    if(!empty($state['adminAccount']))
    {
        $admins = array_filter(explode(',', $app->company->admins), fn($account) => $account !== $state['adminAccount']);
        $dao->update(TABLE_COMPANY)->set('admins')->eq(',' . implode(',', $admins) . ',')->where('id')->eq($app->company->id)->exec();
    }
    $actions = $dao->select('id')->from(TABLE_ACTION)->where('actor')->in($state['accounts'])->fetchPairs('id','id');
    $dao->delete()->from(TABLE_HISTORY)->where('action')->in($actions)->exec();
    $dao->delete()->from(TABLE_ACTION)->where('id')->in($actions)->exec();
    foreach(array(TABLE_USERGROUP=>'account',TABLE_USERVIEW=>'account',TABLE_USER=>'account',TABLE_SCORE=>'account') as $table=>$field)
        $dao->delete()->from($table)->where($field)->in($state['accounts'])->exec();
    $dao->delete()->from(TABLE_GROUPPRIV)->where('group')->in($state['groups'])->exec();
    $dao->delete()->from(TABLE_GROUP)->where('id')->in($state['groups'])->exec();
    $dao->delete()->from(TABLE_SEARCHINDEX)->where('objectType')->eq('task')->andWhere('objectID')->in($state['tasks'])->exec();
    $dao->delete()->from(TABLE_SEARCHINDEX)->where('objectType')->in('program,project,execution')->andWhere('objectID')->in($state['projects'])->exec();
    $dao->delete()->from(TABLE_TASK)->where('id')->in($state['tasks'])->exec();
    $dao->delete()->from(TABLE_PROJECT)->where('id')->in($state['projects'])->exec();
    foreach($state['sessions'] as $session) @unlink(session_save_path() . '/sess_' . $session);
    unlink($stateFile);
    echo "Browser fixtures removed.\n";
    exit;
}
if(is_file($stateFile)) die("Clean up the existing fixture first.\n");
$setting = $tester->loadModel('setting');
$setting->updateVersion($config->version);
$setting->setItem('system.common.global.flow', 'full');
$setting->setItem('system.common.global.mode', 'ALM');
$state = array('accounts'=>array(), 'groups'=>array(), 'projects'=>array(), 'tasks'=>array(), 'sessions'=>array());
$insert = function(string $table,array $row) use($dao): int
{
    $dao->insert($table)->data((object)$row)->exec();
    if(dao::isError()) throw new RuntimeException(json_encode(dao::getError()));
    return (int)$dao->lastInsertId();
};
$tag=bin2hex(random_bytes(3));
$program=$insert(TABLE_PROJECT,array('type'=>'program','name'=>'项目集甘特图测试 '.$tag,'vision'=>'rnd','status'=>'doing','begin'=>'2026-01-01','end'=>'2026-12-31','acl'=>'open','grade'=>1));
$project=$insert(TABLE_PROJECT,array('type'=>'project','name'=>'跨团队交付项目','vision'=>'rnd','status'=>'doing','begin'=>'2026-01-01','end'=>'2026-12-31','acl'=>'open','parent'=>$program,'grade'=>2,'model'=>'scrum','multiple'=>1,'taskDateLimit'=>'limit','hasProduct'=>0));
$execution=$insert(TABLE_PROJECT,array('type'=>'sprint','name'=>'开发迭代一','vision'=>'rnd','status'=>'doing','begin'=>'2026-02-01','end'=>'2026-11-30','acl'=>'open','parent'=>$project,'project'=>$project,'grade'=>1,'multiple'=>1));
$state['projects']=array($program,$project,$execution);
foreach(array($program=>",$program,",$project=>",$program,$project,",$execution=>",$program,$project,$execution,") as $id=>$path)
    $dao->update(TABLE_PROJECT)->set('path')->eq($path)->where('id')->eq($id)->exec();
for($i=0;$i<34;$i++)
{
    $state['tasks'][]=$insert(TABLE_TASK,array('name'=> $i==0 ? '中文任务 <img src=x onerror=alert(1)>' : ($i==1 ? '未排期任务' : '任务 '.str_pad((string)$i,2,'0',STR_PAD_LEFT)),
        'project'=>$project,'execution'=>$execution,'type'=>'devel','status'=>'wait','consumed'=>0,'left'=>8,'estimate'=>8,
        'estStarted'=>$i==1 ? null : '2026-03-01','deadline'=>$i==1 ? null : '2026-03-10'));
}
$rights=array('index'=>array('index'), 'my'=>array('index'),'program'=>array('browse','gantt','ganttEdit','ganttExport'), 'project'=>array('browse','index','edit'), 'execution'=>array('all','task','edit'), 'task'=>array('view','edit'));
foreach(array('editor','reader','admin') as $role)
{
    $account='gantt_'.$role.'_'.$tag; $state['accounts'][]=$account;
    $userID=$insert(TABLE_USER,array('account'=>$account,'realname'=>'Gantt '.$role,'password'=>md5(bin2hex(random_bytes(24))),'visions'=>'rnd','role'=>'dev','deleted'=>0));
    if($role === 'admin')
    {
        $state['adminAccount'] = $account;
        $app->company->admins = ',' . implode(',', array_filter(explode(',', $app->company->admins))) . ',' . $account . ',';
        $dao->update(TABLE_COMPANY)->set('admins')->eq($app->company->admins)->where('id')->eq($app->company->id)->exec();
        $dao->update(TABLE_PROJECT)->set('PM')->eq($account)->where('id')->eq($project)->exec();
    }
    $group=$insert(TABLE_GROUP,array('name'=>'Gantt '.$tag.' '.$role,'vision'=>'rnd'));$state['groups'][]=$group;
    $insert(TABLE_USERGROUP,array('account'=>$account,'group'=>$group));
    foreach($rights as $module=>$methods) foreach($methods as $method)
    {
        if($role==='reader' && ($method==='ganttEdit' || $method==='ganttExport' || $method==='edit')) continue;
        $insert(TABLE_GROUPPRIV,array('group'=>$group,'module'=>$module,'method'=>strtolower($method)));
    }
    $user=$tester->loadModel('user')->getByID($account);
    $tester->user->login($user,false);
    $state[$role]=array('cookie'=>array('name'=>$config->sessionVar,'value'=>session_id(),'domain'=>'127.0.0.1','path'=>'/'), 'account'=>$account);
    $state['sessions'][]=session_id();
    session_write_close();
    session_id(bin2hex(random_bytes(16)));session_start();$_SESSION=array();
}
$state['program']=$program;$state['project']=$project;$state['execution']=$execution;$state['task']=$state['tasks'][0];
file_put_contents($stateFile,json_encode($state,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE));chmod($stateFile,0600);
echo "Browser fixtures ready.\n";
