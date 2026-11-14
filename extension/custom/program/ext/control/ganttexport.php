<?php
class program extends control
{
    /** Re-authorize and re-fetch before rendering an export in the browser. */
    public function ganttExport(int $programID = 0)
    {
        header('Cache-Control: no-store, private');
        if(!common::hasPriv('program', 'gantt') || !common::hasPriv('program', 'ganttExport'))
            return $this->send(array('result' => 'fail', 'message' => $this->lang->program->ganttLang['denied']));
        try
        {
            $nodes = $this->program->loadExtension('programgantt')->getData($programID);
            return $this->send(array('result' => 'success', 'nodes' => $nodes));
        }
        catch(DomainException $error)
        {
            return $this->send(array('result' => 'fail', 'message' => $error->getMessage()));
        }
    }
}
