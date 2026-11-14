<?php
if(($config->systemMode ?? '') === 'light' || !helper::hasFeature('program')) return;

if(!isset($lang->program->homeMenu, $lang->program->menu)) return;

$lang->program->homeMenu->gantt = array('link' => "專案集甘特圖" . '|program|gantt|');
$lang->program->menu->gantt = array('link' => "專案集甘特圖" . '|program|gantt|programID=%s');
$lang->program->menuOrder[12] = 'gantt';
