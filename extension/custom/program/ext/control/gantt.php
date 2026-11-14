<?php
class program extends control
{
    public function gantt(int $programID = 0)
    {
        header('Cache-Control: no-store, private');
        try
        {
            $nodes = $this->program->loadExtension('programgantt')->getData($programID);
        }
        catch(DomainException $error)
        {
            return $this->sendError($error->getMessage());
        }
        if(empty($_SESSION['programGanttToken'])) $_SESSION['programGanttToken'] = bin2hex(random_bytes(32));
        $this->view->title = $this->lang->program->gantt;
        $this->view->ganttOptions = array('nodes' => $nodes, 'programID' => $programID,
            'canEdit' => common::hasPriv('program', 'ganttEdit'), 'canExport' => common::hasPriv('program', 'ganttExport'),
            'token' => $_SESSION['programGanttToken'], 'lang' => $this->lang->program->ganttLang,
            'saveURL' => $this->createLink('program', 'ganttEdit'), 'exportURL' => $this->createLink('program', 'ganttExport', "programID=$programID"));
        $this->display();
    }
}
