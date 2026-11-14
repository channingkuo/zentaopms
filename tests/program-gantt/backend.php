#!/usr/bin/env php
<?php
/** Run against the configured test database; fixtures are isolated and removed. */
require dirname(__DIR__, 2) . '/test/lib/init.php';

function verify(bool $result, string $label): void
{
    if(!$result) throw new RuntimeException('FAILED: ' . $label);
    echo "PASS: $label\n";
}
function denied(callable $action, string $label, string $message = ''): void
{
    try { $action(); } catch(DomainException $error) { verify(!$message || $error->getMessage() == $message, $label); return; }
    throw new RuntimeException('FAILED: ' . $label . ' was accepted');
}

$created = array('projects' => array(), 'tasks' => array(), 'groups' => array());
$baseUser = $app->user;
$account = 'gantt_regression';
$rights = array('rights' => array('program' => array('gantt'=>1, 'ganttedit'=>1, 'ganttexport'=>1, 'edit'=>1), 'project'=>array('edit'=>1), 'execution'=>array('edit'=>1), 'task'=>array('edit'=>1)), 'acls'=>array(), 'programs'=>'', 'projects'=>'', 'products'=>'', 'executions'=>'');
$setUser = function(bool $admin, array $view = array(), ?array $permissions = null) use ($app, $account, $rights)
{
    $app->user = (object)array('account'=>$account, 'admin'=>$admin, 'rights'=>$permissions ?? $rights, 'view'=>(object)array_merge(array('programs'=>'','projects'=>'','sprints'=>''), $view));
    $_SESSION['user'] = $app->user;
    common::$userPrivs = array();
};
$service = function() use($tester) { return $tester->loadModel('program')->loadExtension('programgantt'); };
/* Use a fresh service to simulate a new request, including scoped permission caches. */
$service();
$newService = fn() => new programganttProgram();
$insert = function(string $table, array $data) use($tester): int
{
    $tester->dao->insert($table)->data((object)$data)->exec();
    if(dao::isError()) throw new RuntimeException(json_encode(dao::getError()));
    return (int)$tester->dao->lastInsertId();
};
$project = function(string $type, string $name, int $parent = 0, int $projectID = 0, string $path = '', array $extra = array()) use($insert, &$created, $tester): int
{
    $id = $insert(TABLE_PROJECT, array_merge(array('type'=>$type, 'name'=>$name, 'parent'=>$parent, 'project'=>$projectID, 'path'=>$path,
        'begin'=>'2026-01-01','end'=>'2026-12-31','status'=>'doing','vision'=>'rnd','multiple'=>1,'model'=>'scrum','acl'=>'private','auth'=>'extend','taskDateLimit'=>'limit','hasProduct'=>0), $extra));
    $created['projects'][] = $id;
    $tester->dao->update(TABLE_PROJECT)->set('path')->eq($path . $id . ',')->where('id')->eq($id)->exec();
    return $id;
};
$task = function(string $name, int $projectID, int $executionID, array $extra = array()) use($insert,&$created): int
{
    $id = $insert(TABLE_TASK, array_merge(array('name'=>$name,'project'=>$projectID,'execution'=>$executionID,'status'=>'wait','type'=>'devel',
        'estStarted'=>'2026-03-01','deadline'=>'2026-03-10','assignedTo'=>'gantt_regression','openedBy'=>'gantt_regression','consumed'=>2,'left'=>6),$extra));
    $created['tasks'][] = $id;
    return $id;
};

try
{
    $setUser(true);
    $a = $project('program', 'Gantt public program', 0, 0, ',');
    $b = $project('program', 'Gantt private program', 0, 0, ',');
    $p = $project('project', 'Gantt public project', $a, 0, ",$a,");
    $q = $project('project', 'Gantt SECRET project', $b, 0, ",$b,");
    $e = $project('sprint', 'Gantt execution', $p, $p, ",$a,$p,", array('begin'=>'2026-02-01','end'=>'2026-11-30'));
    $f = $project('sprint', 'Gantt SECRET execution', $q, $q, ",$b,$q,");
    $t = $task('Gantt 中文任务 <img src=x onerror=alert(1)>', $p, $e);
    $secret = $task('Gantt SECRET task', $q, $f);
    $unset = $task('Gantt unscheduled', $p, $e, array('estStarted'=>null,'deadline'=>null));
    $deleted = $task('Gantt DELETED task', $p, $e, array('deleted'=>1));
    $setUser(false, array('programs'=>(string)$a,'projects'=>(string)$p,'sprints'=>(string)$e));
    $data = $newService()->getData();
    $ids = array_column($data,'id');
    verify(in_array("t$t",$ids) && in_array("p$a",$ids), 'visible hierarchy is returned');
    verify(!str_contains(json_encode($data),'SECRET') && !in_array("t$deleted",$ids), 'private and deleted objects are excluded');
    verify(!isset($data[0]['path']) && !isset($data[0]['desc']), 'response uses a field allowlist');
    $taskNode = array_values(array_filter($data,fn($n)=>$n['id']=="t$t"))[0];
    verify($taskNode['progress'] == 25 && $taskNode['editable'], 'task progress and edit permission');
    denied(fn()=>$newService()->getData($b), 'inaccessible direct program ID is rejected');
    $setUser(false,array('programs'=>'','projects'=>(string)$p,'sprints'=>(string)$e));
    $data=$newService()->getData();
    $projectNode=array_values(array_filter($data,fn($n)=>$n['id']=="p$p"))[0];
    verify($projectNode['parent']==='' && !in_array("p$a",array_column($data,'id')), 'hidden ancestor IDs are not leaked');
    $setUser(false,array('programs'=>(string)$a,'projects'=>(string)$p,'sprints'=>''));
    verify(!in_array("t$t",array_column($newService()->getData(),'id')), 'task requires execution visibility as well as project visibility');

    $view=array('programs'=>(string)$a,'projects'=>(string)$p,'sprints'=>(string)$e);
    $setUser(false,$view);
    verify($newService()->saveDates('task',$t,'2026-03-02','2026-03-11','2026-03-01','2026-03-10'), 'task dates save through native date model');
    $saved=$tester->dao->select('*')->from(TABLE_TASK)->where('id')->eq($t)->fetch();
    verify($saved->estStarted==='2026-03-02' && $saved->deadline==='2026-03-11' && $saved->lastEditedBy===$account, 'inclusive finish and audit editor persisted');
    $action=$tester->dao->select('*')->from(TABLE_ACTION)->where('objectType')->eq('task')->andWhere('objectID')->eq($t)->orderBy('id_desc')->fetch();
    verify($action && $tester->dao->select('count(*) AS count')->from(TABLE_HISTORY)->where('action')->eq($action->id)->fetch('count')>=2,'date changes have action history');
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-01','2026-03-10'), 'stale dates cannot overwrite changes',$lang->program->ganttLang['conflict']);
    denied(fn()=>$newService()->saveDates('task',$t,'2026-02-30','2026-03-12','2026-03-02','2026-03-11'), 'invalid calendar dates are rejected');
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-12','2026-03-02','2026-03-02','2026-03-11'), 'reversed dates are rejected');
    denied(fn()=>$newService()->saveDates('task',$t,'2027-01-01','2027-02-01','2026-03-02','2026-03-11'), 'task respects execution/project date bounds');
    denied(fn()=>$newService()->saveDates('execution',$e,'2026-04-01','2026-10-01','2026-02-01','2026-11-30'), 'execution must contain scheduled tasks');
    denied(fn()=>$newService()->saveDates('program',$p,'2026-01-02','2026-12-30','2026-01-01','2026-12-31'), 'object type spoofing is rejected');
    denied(fn()=>$newService()->saveDates('task',$secret,'2026-03-02','2026-03-11','2026-03-01','2026-03-10'), 'crafted edits cannot access private objects');
    verify($newService()->saveDates('task',$unset,'2026-05-01','2026-05-01','',''), 'unscheduled item supports one-day scheduling');
    verify($newService()->saveDates('execution',$e,'2026-02-02','2026-11-29','2026-02-01','2026-11-30'), 'execution dates save');
    verify($newService()->saveDates('project',$p,'2026-01-02','2026-12-30','2026-01-01','2026-12-31'), 'project date-only save');
    $projectAfter=$tester->dao->select('*')->from(TABLE_PROJECT)->where('id')->eq($p)->fetch();
    verify($projectAfter->name==='Gantt public project' && $projectAfter->acl==='private' && $projectAfter->parent==$a, 'date-only save preserves project relations');
    $readonly=$rights; unset($readonly['rights']['program']['ganttedit']);
    $setUser(false,$view,$readonly);
    verify(!array_filter($newService()->getData(),fn($n)=>$n['editable']), 'view-only role has no editable items');
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-02','2026-03-11'),'view-only role cannot POST edits');
    $noTask=$rights; unset($noTask['rights']['task']['edit']);
    $setUser(false,$view,$noTask);
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-02','2026-03-11'),'Gantt edit does not grant native task edit');
    $setUser(false,$view);
    $tester->dao->update(TABLE_PROJECT)->set('auth')->eq('reset')->where('id')->eq($p)->exec();
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-02','2026-03-11'),'project reset permissions override global edit');
    $group = $insert(TABLE_GROUP, array('name'=>'Gantt reset regression', 'project'=>$p, 'vision'=>'rnd'));
    $created['groups'][]=$group;
    $insert(TABLE_USERGROUP, array('account'=>$account, 'group'=>$group));
    $insert(TABLE_GROUPPRIV, array('group'=>$group, 'module'=>'task', 'method'=>'edit'));
    $setUser(false,$view,$noTask);
    verify($newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-02','2026-03-11'),'project reset group can grant native edit');
    $tester->dao->update(TABLE_TASK)->set('estStarted')->eq('2026-03-02')->set('deadline')->eq('2026-03-11')->where('id')->eq($t)->exec();
    $tester->dao->update(TABLE_PROJECT)->set('auth')->eq('extend')->where('id')->eq($p)->exec();
    $setUser(false,$view);
    $tester->dao->update(TABLE_PROJECT)->set('frozen')->eq(1)->where('id')->eq($e)->exec();
    denied(fn()=>$newService()->saveDates('task',$t,'2026-03-03','2026-03-12','2026-03-02','2026-03-11'),'frozen execution blocks task date changes');
    $tester->dao->update(TABLE_PROJECT)->set('frozen')->eq(0)->where('id')->eq($e)->exec();
    $unrelated=$task('Gantt limited unrelated', $p, $e, array('assignedTo'=>'other','openedBy'=>'other'));
    $limited=$rights;$limited['rights']['my']['limited']=1;
    $setUser(false,$view,$limited);
    denied(fn()=>$newService()->saveDates('task',$unrelated,'2026-03-02','2026-03-11','2026-03-01','2026-03-10'),'limited user cannot edit an unrelated task');
    $setUser(true);
    $single=$project('project','Gantt single execution',$a,0,",$a,",array('multiple'=>0));
    $internal=$project('sprint','Gantt internal sprint',$single,$single,",$a,$single,",array('multiple'=>0));
    $singleTask=$task('Gantt single task',$single,$internal);
    $tree=$newService()->getData($a);
    $singleNode=array_values(array_filter($tree,fn($n)=>$n['id']=="t$singleTask"))[0];
    verify(!in_array("p$internal",array_column($tree,'id')) && $singleNode['parent']=="p$single",'single-execution tasks attach directly to their project');
    verify($newService()->saveDates('project',$single,'2026-01-02','2026-12-30','2026-01-01','2026-12-31'),'single-execution project dates save');
    $hidden=$tester->dao->select('*')->from(TABLE_PROJECT)->where('id')->eq($internal)->fetch();
    verify($hidden->begin==='2026-01-02' && $hidden->end==='2026-12-30' && $hidden->name==='Gantt internal sprint','hidden execution inherits dates without unrelated edits');
    $parentTask=$task('Gantt parent task',$p,$e,array('estStarted'=>'2026-05-01','deadline'=>'2026-06-30','isParent'=>1));
    $childTask=$task('Gantt child task',$p,$e,array('parent'=>$parentTask,'path'=>",$parentTask,",'estStarted'=>'2026-05-10','deadline'=>'2026-05-20'));
    denied(fn()=>$newService()->saveDates('task',$childTask,'2026-04-01','2026-04-10','2026-05-10','2026-05-20'),'child task stays within parent task dates');
    denied(fn()=>$newService()->saveDates('task',$parentTask,'2026-06-01','2026-06-30','2026-05-01','2026-06-30'),'parent task cannot exclude existing children');
    denied(fn()=>$newService()->saveDates('program',$a,'2026-04-01','2026-12-31','2026-01-01','2026-12-31'),'program cannot exclude existing child projects');
    verify($newService()->saveDates('program',$a,'2025-12-31','2027-01-01','2026-01-01','2026-12-31'),'program dates save with audit history');
    $none=$rights; unset($none['rights']['program']['gantt']); $setUser(false,$view,$none);
    denied(fn()=>$newService()->getData(),'missing Gantt view permission blocks data');
    verify(!$tester->dao->inTransaction(), 'failed edits roll back and release transactions');
    echo "All backend regression checks passed.\n";
}
finally
{
    if($tester->dao->inTransaction()) $tester->dao->rollBack();
    dao::$errors=array();
    $actions=$tester->dao->select('id')->from(TABLE_ACTION)->where('actor')->eq($account)->fetchPairs('id','id');
    $tester->dao->delete()->from(TABLE_HISTORY)->where('action')->in($actions)->exec();
    $tester->dao->delete()->from(TABLE_ACTION)->where('id')->in($actions)->exec();
    $tester->dao->delete()->from(TABLE_GROUPPRIV)->where('group')->in($created['groups'])->exec();
    $tester->dao->delete()->from(TABLE_USERGROUP)->where('group')->in($created['groups'])->exec();
    $tester->dao->delete()->from(TABLE_GROUP)->where('id')->in($created['groups'])->exec();
    $tester->dao->delete()->from(TABLE_SEARCHINDEX)->where('objectType')->eq('task')->andWhere('objectID')->in($created['tasks'])->exec();
    $tester->dao->delete()->from(TABLE_SEARCHINDEX)->where('objectType')->in('program,project,execution')->andWhere('objectID')->in($created['projects'])->exec();
    $tester->dao->delete()->from(TABLE_TASK)->where('id')->in($created['tasks'])->exec();
    $tester->dao->delete()->from(TABLE_PROJECT)->where('id')->in($created['projects'])->exec();
    $app->user=$baseUser; $_SESSION['user']=$baseUser;
}
