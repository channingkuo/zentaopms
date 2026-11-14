<?php
if(($config->systemMode ?? '') === 'light' || !helper::hasFeature('program')) return;

$config->group->package->programGantt = new stdclass();
$config->group->package->programGantt->order = 12;
$config->group->package->programGantt->subset = 'program';
$config->group->package->programGantt->privs = array();
foreach(array('gantt', 'ganttEdit', 'ganttExport') as $order => $method)
{
    $config->group->package->programGantt->privs['program-' . $method] = array(
        'edition' => 'open,biz,max,ipd', 'vision' => 'rnd', 'order' => $order * 5,
        'depend' => $method == 'gantt' ? array() : array('program-gantt'), 'recommend' => array());
}
