#!/bin/bash

start_time="$(date +"%T")"
starting_dir=${PWD}

echo "***   Installation of EVO_SABRE for moOde" 
echo "***   _____________________________________" 

# Install modules
for file in "$starting_dir"/*
do 
    test -f $file/install.sh && cd $file && bash $file/install.sh 
    cd $starting_dir
done

# ---------------------------------------------------
# Say something nice and exit
echo "* End of installation : EVO_SABRE for moOde"
echo started at $start_time finished at "$(date +"%T")"
exit 0